/**
 * shoppub-order-sync — drena pedidos recentes da Shoppub pra dentro de
 * `orders`, casados por telefone com o contato do WhatsApp.
 *
 * ─── Por que INCREMENTAL, não o histórico inteiro ───────────────────────────
 *
 * A loja tem 62 mil pedidos, e `GET /pedidos/` trava em 25 por página
 * (medido — diferente de `/produtos/` e `/clientes/`, que aceitam mais):
 * 2500+ páginas pro histórico completo. O que alimenta "Pedidos recentes" no
 * painel do contato é CONTEXTO DE ATENDIMENTO — pedido de anos atrás não
 * ajuda o atendente agora. `min_data` filtra por data de criação; a primeira
 * rodada usa `PRIMEIRA_SYNC_DIAS_ATRAS` como piso, e dali em diante o sync é
 * incremental de verdade (só o que mudou desde a última rodada completa) —
 * mesmo raciocínio do `dataAlteracao` da Tiny.
 *
 * ─── Por que resolve contact_id em LOTE, não pedido a pedido ────────────────
 *
 * Uma consulta a `contacts` por pedido seria o mesmo N+1 que o catálogo
 * evitou pra estoque. Cada página vira UMA consulta `phone_number = any(...)`
 * pros telefones da página inteira, e o mapa telefone→contact_id serve todos
 * os pedidos daquela página.
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { ShoppubApiClient } from "@/lib/shoppub/api-client";
import { mapearPedido } from "@/lib/shoppub/mapear-pedido";
import { normalizePhoneBR } from "@/lib/webhooks/inbound";

export const dynamic = "force-dynamic";

/** Teto de páginas processadas por rodada — protege o rate limit (120/min documentado). */
const PAGINAS_POR_RODADA = 20;
/** Piso da PRIMEIRA sincronização — antes disso não existe `order_sync_last_at` ainda. */
const PRIMEIRA_SYNC_DIAS_ATRAS = 30;

function dataMinima(iso: string | undefined): string {
  if (iso) return iso.slice(0, 10);
  const piso = new Date(Date.now() - PRIMEIRA_SYNC_DIAS_ATRAS * 24 * 60 * 60 * 1000);
  return piso.toISOString().slice(0, 10);
}

interface LinhaDeIntegracao {
  id: string;
  organization_id: string;
  oauth_access_token_encrypted: string;
  store_metadata: {
    subdominio?: string;
    order_sync_page?: number;
    order_sync_last_at?: string;
  } | null;
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
  const minData = dataMinima(row.store_metadata?.order_sync_last_at);

  let processados = 0;
  let erros = 0;
  let pagina = row.store_metadata?.order_sync_page ?? 1;
  let esgotouTudo = false;

  for (let i = 0; i < PAGINAS_POR_RODADA; i++) {
    let resposta;
    try {
      resposta = await client.listarPedidos({ page: pagina, minData });
    } catch (err) {
      logger.warn("[shoppub-order-sync] listarPedidos falhou", {
        organizationId: row.organization_id,
        pagina,
        detail: err instanceof Error ? err.message : "erro",
      });
      erros++;
      break;
    }

    if (resposta.results.length > 0) {
      // Telefones da PÁGINA inteira, uma consulta só — não um SELECT por pedido.
      const telefones = [
        ...new Set(
          resposta.results
            .map((p) => normalizePhoneBR(p.celular) ?? normalizePhoneBR(p.telefone1))
            .filter((t): t is string => t !== null),
        ),
      ];
      const mapaContatos = new Map<string, string>();
      if (telefones.length > 0) {
        const { data: contatos } = await admin
          .from("contacts")
          .select("id, phone_number")
          .eq("organization_id", row.organization_id)
          .in("phone_number", telefones);
        for (const c of (contatos ?? []) as Array<{ id: string; phone_number: string }>) {
          mapaContatos.set(c.phone_number, c.id);
        }
      }

      const linhas = resposta.results.map((p) => {
        const telefone = normalizePhoneBR(p.celular) ?? normalizePhoneBR(p.telefone1);
        const contactId = telefone ? (mapaContatos.get(telefone) ?? null) : null;
        return mapearPedido(p, row.organization_id, contactId);
      });

      const { error } = await admin
        .from("orders")
        .upsert(linhas, { onConflict: "organization_id,external_provider,external_id" });
      if (error) {
        erros += linhas.length;
        logger.warn("[shoppub-order-sync] upsert em lote falhou", {
          organizationId: row.organization_id,
          pagina,
          detail: error.message,
        });
      } else {
        processados += linhas.length;
      }
    }

    if (!resposta.next) {
      esgotouTudo = true;
      break; // última página — esgotou de verdade
    }
    pagina++;
  }

  await admin
    .from("tenant_integrations")
    .update({
      store_metadata: {
        ...row.store_metadata,
        order_sync_page: esgotouTudo ? 1 : pagina,
        // Só avança o piso quando o pass INTEIRO termina — mesma doutrina
        // do `last_sync_at` do catálogo: parar no meio e avançar o piso faria
        // a próxima rodada nunca mais ver os pedidos que ficaram de fora.
        order_sync_last_at: esgotouTudo
          ? new Date().toISOString()
          : row.store_metadata?.order_sync_last_at,
      },
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
    .select("id, organization_id, oauth_access_token_encrypted, store_metadata")
    .eq("provider", "shoppub")
    .eq("status", "healthy");

  if (error) {
    logger.error("[shoppub-order-sync] query falhou", { detail: error.message, requestId });
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
      logger.warn("[shoppub-order-sync] falhou numa organização", {
        organizationId: row.organization_id,
        detail: err instanceof Error ? err.message : "erro",
        requestId,
      });
    }
  }

  return ok(
    { integracoes: integracoes.length, pedidos_processados: totalProcessados, erros: totalErros },
    { requestId },
  );
}

export const GET = handle;
export const POST = handle;
