/**
 * shoppub-customer-sync — drena a base de clientes da Shoppub pra dentro de
 * `commerce_customers`.
 *
 * ─── Por que sincronizar em vez de perguntar ao vivo ────────────────────────
 *
 * `GET /clientes/` não tem busca por telefone/e-mail (só CPF/CNPJ/tipo —
 * verificado direto na doc, 2026-09-17), e a loja tem ~53 mil clientes:
 * perguntar "qual cliente é esse contato do WhatsApp" ao vivo, toda vez que
 * o Inbox abre uma conversa, paginaria milhares de páginas por conversa
 * aberta. Sincronizar uma vez e consultar localmente por `telefone_e164` é
 * o mesmo raciocínio do catálogo de produtos (`shoppub-backfill`).
 *
 * ─── Mesmo padrão resumível do catálogo ─────────────────────────────────────
 *
 * `store_metadata.customer_sync_page` — CHAVE DIFERENTE de
 * `backfill_page` (que é do catálogo de produtos): são dois streams de
 * sincronização independentes na MESMA integração, cada um com seu próprio
 * ponteiro de página, sem um pisar no do outro.
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { ShoppubApiClient } from "@/lib/shoppub/api-client";
import { mapearCliente } from "@/lib/shoppub/mapear-cliente";

export const dynamic = "force-dynamic";

/** Teto de páginas processadas por rodada — protege o rate limit (120/min documentado). */
const PAGINAS_POR_RODADA = 50;

interface LinhaDeIntegracao {
  id: string;
  organization_id: string;
  oauth_access_token_encrypted: string;
  store_metadata: { subdominio?: string; customer_sync_page?: number } | null;
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
  let pagina = row.store_metadata?.customer_sync_page ?? 1;
  let esgotouTudo = false;

  for (let i = 0; i < PAGINAS_POR_RODADA; i++) {
    let resposta;
    try {
      resposta = await client.listarClientes({ page: pagina });
    } catch (err) {
      logger.warn("[shoppub-customer-sync] listarClientes falhou", {
        organizationId: row.organization_id,
        pagina,
        detail: err instanceof Error ? err.message : "erro",
      });
      erros++;
      break;
    }

    if (resposta.results.length > 0) {
      const linhas = resposta.results.map((c) => mapearCliente(c, row.organization_id));
      const { error } = await admin
        .from("commerce_customers")
        .upsert(linhas, { onConflict: "organization_id,origem,external_id" });
      if (error) {
        erros += linhas.length;
        logger.warn("[shoppub-customer-sync] upsert em lote falhou", {
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
      store_metadata: { ...row.store_metadata, customer_sync_page: esgotouTudo ? 1 : pagina },
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
    logger.error("[shoppub-customer-sync] query falhou", { detail: error.message, requestId });
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
      logger.warn("[shoppub-customer-sync] falhou numa organização", {
        organizationId: row.organization_id,
        detail: err instanceof Error ? err.message : "erro",
        requestId,
      });
    }
  }

  return ok(
    { integracoes: integracoes.length, clientes_processados: totalProcessados, erros: totalErros },
    { requestId },
  );
}

export const GET = handle;
export const POST = handle;
