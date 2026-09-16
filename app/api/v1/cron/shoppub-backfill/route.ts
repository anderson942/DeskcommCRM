/**
 * shoppub-backfill — drena o catálogo da Shoppub pra dentro de `catalog_products`.
 *
 * ─── Por que cron, se a Shoppub já empurra webhook ──────────────────────────
 *
 * O webhook (`app/api/v1/webhooks/shoppub/[token]`) é a fonte de FRESCOR —
 * dispara na hora em que preço/estoque muda. Esta rota é a REDE DE SEGURANÇA:
 * a carga inicial (produto que já existia antes de conectar nunca dispara
 * webhook nenhum) e a reconciliação periódica pra cobrir um webhook que
 * falhou as 5 tentativas da Shoppub (documentado: retry só por 15min).
 *
 * ─── Por que NÃO precisa da chamada extra de estoque que a Tiny precisava ──
 *
 * `GET /produtos/` da Shoppub já devolve preço (de/por) E estoque por item —
 * zero chamada N+1. É por isso que esta rota processa uma PÁGINA inteira por
 * vez (upsert em lote), enquanto `tiny-stock-sync` processa produto a
 * produto: lá cada item exigia um `GET /estoque/{id}` à parte.
 *
 * ─── Por que retoma de onde parou (mesmo padrão da Tiny) ────────────────────
 *
 * Sem persistir a página entre rodadas, um catálogo grande (a Tiny tinha 51
 * mil produtos) nunca sairia da primeira página — cada rodada recomeçaria do
 * zero. `store_metadata.backfill_page` guarda onde parar; zera quando o pass
 * INTEIRO termina (`next: null` na última página).
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehVendavel } from "@/lib/shoppub/config";
import { ShoppubApiClient } from "@/lib/shoppub/api-client";
import { mapearProduto } from "@/lib/shoppub/mapear-produto";

export const dynamic = "force-dynamic";

/** Teto de páginas processadas por rodada — protege o rate limit (120/min documentado). */
const PAGINAS_POR_RODADA = 40;

interface LinhaDeIntegracao {
  id: string;
  organization_id: string;
  oauth_access_token_encrypted: string;
  store_metadata: { subdominio?: string; backfill_page?: number } | null;
  last_sync_at: string | null;
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

  let processados = 0;
  let erros = 0;
  // ⚠️ RETOMA de onde a rodada anterior parou (mesmo raciocínio da 0264/Tiny).
  let pagina = row.store_metadata?.backfill_page ?? 1;
  let esgotouTudo = false;

  for (let i = 0; i < PAGINAS_POR_RODADA; i++) {
    let resposta;
    try {
      resposta = await client.listarProdutos({ page: pagina });
    } catch (err) {
      logger.warn("[shoppub-backfill] listarProdutos falhou", {
        organizationId: row.organization_id,
        pagina,
        detail: err instanceof Error ? err.message : "erro",
      });
      erros++;
      break;
    }

    const vendaveis = resposta.results.filter(ehVendavel);
    if (vendaveis.length > 0) {
      const linhas = vendaveis.map((p) => mapearProduto(p, row.organization_id, subdominio));
      const { error } = await admin
        .from("catalog_products")
        .upsert(linhas, { onConflict: "organization_id,codigo" });
      if (error) {
        erros += linhas.length;
        logger.warn("[shoppub-backfill] upsert em lote falhou", {
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
      last_sync_at: esgotouTudo ? new Date().toISOString() : row.last_sync_at,
      store_metadata: { ...row.store_metadata, backfill_page: esgotouTudo ? 1 : pagina },
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
    .select("id, organization_id, oauth_access_token_encrypted, store_metadata, last_sync_at")
    .eq("provider", "shoppub")
    .eq("status", "healthy");

  if (error) {
    logger.error("[shoppub-backfill] query falhou", { detail: error.message, requestId });
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
      logger.warn("[shoppub-backfill] falhou numa organização", {
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
