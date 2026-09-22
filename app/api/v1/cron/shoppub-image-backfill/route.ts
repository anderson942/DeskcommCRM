/**
 * shoppub-image-backfill — preenche `catalog_products.imagem_url` pros
 * produtos de origem Shoppub que ainda não foram checados (0274).
 *
 * ─── Por que é um cron À PARTE, e não uma chamada a mais no `shoppub-backfill` ──
 *
 * `shoppub-backfill` processa uma PÁGINA inteira por vez, em lote, porque
 * `GET /produtos/` já traz preço e estoque de todos os itens da página —
 * zero chamada extra por produto (documentado no topo daquele arquivo).
 * Imagem é diferente: `GET /produto-imagens/{sku}/` é um endpoint À PARTE,
 * sem versão em lote, uma chamada POR PRODUTO. Encaixar isso dentro do
 * backfill de catálogo transformaria uma rotina hoje O(páginas) em
 * O(produtos) — 40 páginas por rodada virariam milhares de chamadas de
 * imagem na mesma janela de 90s, e o rate limit (120/min, POR CONTA,
 * compartilhado com clientes/pedidos) estouraria em toda rodada.
 *
 * ─── Por que não usa `imagem_url is null` como critério do que falta ────────
 *
 * Produto que genuinamente NÃO TEM foto na Shoppub responde lista vazia, não
 * erro — `imagem_url` fica NULL depois de checado do MESMO jeito que fica
 * antes de checar. Usar `imagem_url is null` reconsultaria esse produto pra
 * sempre, sem o backfill nunca convergir. `imagem_checada_em` (0274) marca
 * "já perguntei, seja qual foi a resposta" — o critério de trabalho
 * pendente é `imagem_checada_em is null`, que ENCOLHE de verdade a cada
 * rodada até sobrar só os produtos de fato sem imagem cadastrada (que
 * passam a ser no-op nas rodadas seguintes, iguais a qualquer outro cron
 * ocioso desta base).
 *
 * ─── Cadência (13 min) ───────────────────────────────────────────────────────
 *
 * As outras três rotinas da Shoppub (backfill de catálogo, cliente, pedido)
 * já usam 5/7/11 min — números primos entre si de propósito, pra minimizar
 * coincidência de minuto contra o mesmo teto de 120 req/min. 13 segue o
 * mesmo raciocínio, primo em relação aos três.
 *
 * ─── Teto por rodada e concorrência ─────────────────────────────────────────
 *
 * Mesmo padrão do `tiny-stock-sync` (também N+1, uma chamada por produto,
 * mesma conta com rate limit por conta): lotes de `CONCORRENCIA` em
 * paralelo, e um `rate_limited` em QUALQUER item do lote para a rodada
 * inteira ali (sem cursor pra avançar — a próxima rodada pega os mesmos
 * produtos ainda com `imagem_checada_em is null`, então não perde nenhum).
 * `LIMITE_PRODUTOS_POR_RODADA = 300` a cada 13 min dá uma média de ~23
 * requisições/minuto dedicadas a isto — deixa a maior parte dos 120/min pro
 * resto (backfill de catálogo, cliente, pedido, e o webhook em tempo real).
 * No ritmo de 300/rodada, os ~34 mil produtos sem imagem desta organização
 * (medido em 2026-09-22) levam da ordem de 1 dia corrido pra ficar
 * cobertos, sem competir de verdade com o resto da sincronização.
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { ShoppubApiClient, ShoppubApiError } from "@/lib/shoppub/api-client";
import { imagemPrincipal } from "@/lib/shoppub/mapear-produto";

export const dynamic = "force-dynamic";

const LIMITE_PRODUTOS_POR_RODADA = 300;
/** Mesmo valor do `tiny-stock-sync` — ver o comentário de lá sobre por que 8 é conservador. */
const CONCORRENCIA = 8;

interface LinhaDeIntegracao {
  id: string;
  organization_id: string;
  oauth_access_token_encrypted: string;
  store_metadata: { subdominio?: string } | null;
}

interface LinhaDeProduto {
  id: string;
  codigo: string;
}

type ResultadoImagem = "ok" | "erro" | "rate_limited";

/** Busca a imagem de UM produto e grava. Nunca lança — o chamador roda
 *  vários em paralelo via `Promise.all`, e uma rejeição no meio do lote
 *  derrubaria os outros junto (mesmo contrato de `processarProduto` do
 *  `tiny-stock-sync`). */
async function processarProduto(
  client: ShoppubApiClient,
  admin: ReturnType<typeof createAdminClient>,
  produto: LinhaDeProduto,
  orgId: string,
): Promise<ResultadoImagem> {
  try {
    const imagens = await client.obterImagensDoProduto(produto.codigo);
    const { error } = await admin
      .from("catalog_products")
      .update({ imagem_url: imagemPrincipal(imagens), imagem_checada_em: new Date().toISOString() })
      .eq("id", produto.id);
    if (error) {
      logger.warn("[shoppub-image-backfill] update falhou", {
        organizationId: orgId,
        codigo: produto.codigo,
        detail: error.message,
      });
      return "erro";
    }
    return "ok";
  } catch (err) {
    const rateLimited = err instanceof ShoppubApiError && err.code === "rate_limited";
    logger.warn("[shoppub-image-backfill] falhou num produto", {
      organizationId: orgId,
      codigo: produto.codigo,
      detail: err instanceof Error ? err.message : "erro",
    });
    return rateLimited ? "rate_limited" : "erro";
  }
}

async function sincronizarOrganizacao(
  admin: ReturnType<typeof createAdminClient>,
  row: LinhaDeIntegracao,
): Promise<{ processados: number; erros: number }> {
  const subdominio = row.store_metadata?.subdominio;
  const { data: tokenPlano, error: decErr } = await admin.rpc("fn_decrypt_oauth", {
    ciphertext: row.oauth_access_token_encrypted,
  });
  if (decErr || !tokenPlano || !subdominio) return { processados: 0, erros: 1 };

  const client = new ShoppubApiClient({ subdominio, token: tokenPlano as string });

  const { data: pendentes, error: selectErr } = await admin
    .from("catalog_products")
    .select("id, codigo")
    .eq("organization_id", row.organization_id)
    .eq("origem", "shoppub")
    .is("imagem_checada_em", null)
    .order("id", { ascending: true })
    .limit(LIMITE_PRODUTOS_POR_RODADA);

  if (selectErr) {
    logger.warn("[shoppub-image-backfill] select falhou", {
      organizationId: row.organization_id,
      detail: selectErr.message,
    });
    return { processados: 0, erros: 1 };
  }

  const produtos = (pendentes ?? []) as LinhaDeProduto[];
  let processados = 0;
  let erros = 0;

  for (let i = 0; i < produtos.length; i += CONCORRENCIA) {
    const lote = produtos.slice(i, i + CONCORRENCIA);
    const resultados = await Promise.all(
      lote.map((p) => processarProduto(client, admin, p, row.organization_id)),
    );
    let pararPorRateLimit = false;
    for (const r of resultados) {
      if (r === "ok") processados++;
      else erros++;
      if (r === "rate_limited") pararPorRateLimit = true;
    }
    // Sem cursor pra avançar aqui de propósito: quem ficou de fora (o resto
    // do lote atual + o resto da página) continua com `imagem_checada_em`
    // NULL, e a PRÓXIMA rodada pega exatamente esses de novo — nada se
    // perde, só demora mais uma rodada.
    if (pararPorRateLimit) break;
  }

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
    .select("id, organization_id, oauth_access_token_encrypted, store_metadata")
    .eq("provider", "shoppub")
    .eq("status", "healthy");

  if (error) {
    logger.error("[shoppub-image-backfill] query falhou", { detail: error.message, requestId });
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
      logger.warn("[shoppub-image-backfill] falhou numa organização", {
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
