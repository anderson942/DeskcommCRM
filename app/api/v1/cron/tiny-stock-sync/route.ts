/**
 * tiny-stock-sync — drena o catálogo da Tiny pra dentro de `catalog_products`.
 *
 * ─── Por que cron, não webhook ─────────────────────────────────────────────
 *
 * A Tiny (API v3) não tem API de registro de webhook de estoque — o jeito de
 * saber o que mudou é perguntar. Roda a cada 5 minutos (agendado no
 * `docker/scheduler/entrypoint.sh`), e usa `dataAlteracao` pra só puxar
 * produtos que mudaram desde a última rodada — sync incremental depois da
 * primeira carga completa.
 *
 * ─── Por que o estoque é uma chamada A MAIS por produto ────────────────────
 *
 * `GET /produtos` não traz quantidade em estoque — só preço e cadastro. Saldo
 * de verdade é `GET /estoque/{id}`, um produto por vez. Por isso só busca
 * estoque dos produtos que REALMENTE mudaram na janela, nunca do catálogo
 * inteiro a cada rodada — o rate limit da Tiny é por CONTA, não por app.
 *
 * ─── Token que expira, diferente do Nuvemshop ───────────────────────────────
 *
 * access_token dura 4h, refresh_token dura 1 dia. Cada rodada verifica
 * `expires_at` e renova ANTES de usar, nunca só reagindo a um 401 — se este
 * cron parar de rodar por mais de 24h, o refresh token morre e só reconectar
 * pela tela resolve.
 *
 * ─── Produto sumiu/inativou na Tiny ────────────────────────────────────────
 *
 * Decisão do Anderson (2026-09-15): marca `ativo: false` no catálogo — a IA
 * para de oferecer, sem apagar a linha nem o histórico.
 *
 * Auth: Bearer INTERNAL_CRON_SECRET|INTERNAL_SECRET (mesmo padrão dos outros crons).
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { getConfig, SITUACOES_ATIVAS } from "@/lib/tiny/config";
import { refreshAccessToken } from "@/lib/tiny/oauth";
import { TinyApiClient, TinyApiError, type TinyProduto } from "@/lib/tiny/api-client";

export const dynamic = "force-dynamic";

/** Teto de produtos alterados processados por rodada — protege o rate limit. */
const LIMITE_PRODUTOS_POR_RODADA = 500;
const PAGINA = 100;

interface LinhaDeIntegracao {
  id: string;
  organization_id: string;
  oauth_access_token_encrypted: string;
  oauth_refresh_token_encrypted: string | null;
  expires_at: string | null;
  last_sync_at: string | null;
}

/** "2023-01-01 10:00:00" — o formato que a Tiny espera em `dataAlteracao`. */
function paraDataTiny(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace("T", " ");
}

async function decrypt(admin: ReturnType<typeof createAdminClient>, ciphertext: string): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_decrypt_oauth", { ciphertext });
  if (error || !data) return null;
  return data as string;
}

async function encrypt(admin: ReturnType<typeof createAdminClient>, plaintext: string): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_encrypt_oauth", { plaintext });
  if (error || !data) return null;
  return data as string;
}

async function obterAccessTokenValido(
  admin: ReturnType<typeof createAdminClient>,
  row: LinhaDeIntegracao,
): Promise<string | null> {
  const cfg = getConfig();
  if (!cfg) return null;

  const expiraEm = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const aindaValido = expiraEm > Date.now();

  const accessAtual = await decrypt(admin, row.oauth_access_token_encrypted);
  if (aindaValido && accessAtual) return accessAtual;

  if (!row.oauth_refresh_token_encrypted) return null;
  const refreshAtual = await decrypt(admin, row.oauth_refresh_token_encrypted);
  if (!refreshAtual) return null;

  const renovado = await refreshAccessToken(refreshAtual, cfg);
  if (!renovado.ok) {
    // Refresh token expirado (>1 dia sem rodar) ou revogado — só reconectar
    // pela tela resolve. Marca a integração como precisando de atenção.
    await admin
      .from("tenant_integrations")
      .update({ status: "reauth_required", status_reason: renovado.error })
      .eq("id", row.id);
    return null;
  }

  const novoAccessEnc = await encrypt(admin, renovado.accessToken);
  const novoRefreshEnc = await encrypt(admin, renovado.refreshToken);
  if (!novoAccessEnc || !novoRefreshEnc) return null;

  await admin
    .from("tenant_integrations")
    .update({
      oauth_access_token_encrypted: novoAccessEnc,
      oauth_refresh_token_encrypted: novoRefreshEnc,
      expires_at: new Date(renovado.expiresAt).toISOString(),
    })
    .eq("id", row.id);

  return renovado.accessToken;
}

/** Um produto da Tiny → a linha que `catalog_products` espera. */
function mapearProduto(p: TinyProduto, quantidade: number, orgId: string) {
  return {
    organization_id: orgId,
    codigo: p.sku || String(p.id),
    nome: p.descricao,
    marca: null,
    categoria: null,
    preco_cents: Math.round((p.precos.precoPromocional ?? p.precos.preco) * 100),
    custo_cents: p.precos.precoCusto !== null ? Math.round(p.precos.precoCusto * 100) : null,
    controla_estoque: true,
    quantidade,
    ativo: SITUACOES_ATIVAS.has(p.situacao),
    origem: "tiny",
  };
}

async function sincronizarOrganizacao(
  admin: ReturnType<typeof createAdminClient>,
  row: LinhaDeIntegracao,
): Promise<{ processados: number; erros: number }> {
  const accessToken = await obterAccessTokenValido(admin, row);
  if (!accessToken) return { processados: 0, erros: 1 };

  const client = new TinyApiClient({ accessToken });
  const dataAlteracao = row.last_sync_at ? paraDataTiny(row.last_sync_at) : undefined;

  let processados = 0;
  let erros = 0;
  let offset = 0;
  // Só avança `last_sync_at` quando esgota TODAS as páginas do filtro atual.
  // Se parar por ter batido o teto de produtos por rodada, avançar o
  // carimbo faria a próxima rodada (que filtra por `dataAlteracao` a partir
  // dele) nunca mais ver os produtos que ficaram de fora desta — não é uma
  // rodada mais lenta, é perda silenciosa. Melhor a próxima rodada repetir
  // trabalho do que pular produto.
  let esgotouTudo = true;

  while (processados + erros < LIMITE_PRODUTOS_POR_RODADA) {
    let pagina;
    try {
      pagina = await client.listarProdutos({ limit: PAGINA, offset, dataAlteracao });
    } catch (err) {
      logger.warn("[tiny-stock-sync] listarProdutos falhou", {
        organizationId: row.organization_id,
        detail: err instanceof Error ? err.message : "erro",
      });
      erros++;
      esgotouTudo = false;
      break;
    }

    for (const produto of pagina.itens) {
      try {
        let quantidade = 0;
        if (SITUACOES_ATIVAS.has(produto.situacao)) {
          const estoque = await client.obterEstoque(produto.id);
          quantidade = Math.max(0, estoque.disponivel);
        }
        const linha = mapearProduto(produto, quantidade, row.organization_id);
        const { error } = await admin
          .from("catalog_products")
          .upsert(linha, { onConflict: "organization_id,codigo" });
        if (error) {
          erros++;
          logger.warn("[tiny-stock-sync] upsert falhou", {
            organizationId: row.organization_id,
            codigo: linha.codigo,
            detail: error.message,
          });
        } else {
          processados++;
        }
      } catch (err) {
        erros++;
        // Um produto com estoque indisponível não pode travar o lote inteiro.
        const rateLimited = err instanceof TinyApiError && err.code === "rate_limited";
        logger.warn("[tiny-stock-sync] falhou num produto", {
          organizationId: row.organization_id,
          produtoId: produto.id,
          detail: err instanceof Error ? err.message : "erro",
        });
        if (rateLimited) {
          esgotouTudo = false;
          break; // sem adiantar martelar um 429 no resto do lote
        }
      }
    }

    if (pagina.itens.length < PAGINA) break; // última página — esgotou de verdade
    offset += PAGINA;
    if (processados + erros >= LIMITE_PRODUTOS_POR_RODADA) esgotouTudo = false;
  }

  await admin
    .from("tenant_integrations")
    .update({
      // `null` mantém o filtro `dataAlteracao` da PRÓXIMA rodada igual ao desta
      // — ela repete o trabalho em vez de avançar o carimbo sobre produtos que
      // ficaram de fora. `last_sync_at` só avança quando a rodada viu tudo.
      last_sync_at: esgotouTudo ? new Date().toISOString() : row.last_sync_at,
      status: "healthy",
      status_reason: null,
    })
    .eq("id", row.id);

  return { processados, erros };
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("tenant_integrations")
    .select("id, organization_id, oauth_access_token_encrypted, oauth_refresh_token_encrypted, expires_at, last_sync_at")
    .eq("provider", "tiny")
    .eq("status", "healthy");

  if (error) {
    logger.error("[tiny-stock-sync] query falhou", { detail: error.message, requestId });
    return fail("internal_error", error.message, 500, { requestId });
  }

  const integracoes = (data ?? []) as LinhaDeIntegracao[];
  let totalProcessados = 0;
  let totalErros = 0;

  for (const row of integracoes) {
    try {
      const { processados, erros } = await sincronizarOrganizacao(admin, row);
      totalProcessados += processados;
      totalErros += erros;
    } catch (err) {
      totalErros++;
      logger.warn("[tiny-stock-sync] falhou numa organização", {
        organizationId: row.organization_id,
        detail: err instanceof Error ? err.message : "erro",
        requestId,
      });
    }
  }

  return ok(
    { integracoes: integracoes.length, produtos_processados: totalProcessados, erros: totalErros },
    { requestId },
  );
}

export const GET = handle;
export const POST = handle;
