/**
 * POST /api/v1/webhooks/shoppub/{token} — webhook de produto (preço/estoque).
 *
 * ─── Por que o token vai NA URL, e não num header assinado ─────────────────
 *
 * A Shoppub não documenta HMAC nem secret compartilhado pro webhook (diferente
 * da Nuvemshop, que assina `X-Linkedstore-Hmac-Sha256` — ver
 * `app/api/v1/webhooks/nuvemshop/[event]/route.ts`). O `webhook_path_token`
 * de `tenant_integrations` (coluna que já existe pra exatamente esse caso —
 * provider sem assinatura própria) É a autenticação: opaco, 24 bytes,
 * gerado pelo banco, uma URL por tenant. Rota já é pública por prefixo
 * (`/^\/api\/v1\/webhooks\//` em `lib/auth/public-paths.ts`).
 *
 * ─── Por que busca o produto de novo em vez de confiar no payload ──────────
 *
 * O payload do webhook (visto na doc) só traz `preco` — não `preco_de`. Pra
 * manter o "de X por Y" da tela funcionando também pela Shoppub, a rota faz
 * UMA chamada de volta (`GET /produto/{sku}/`) e usa a resposta completa como
 * fonte da verdade — o mesmo dado que o backfill usa, mesmo mapeamento
 * (`lib/shoppub/mapear-produto.ts`), sem duas cópias da regra.
 *
 * ─── Por que 200 pra token errado, mas NÃO pra falha de banco ──────────────
 *
 * Token que não bate com nenhum tenant é webhook velho/mal configurado — 200
 * evita retry inútil. Falha real (upsert, decrypt) devolve 5xx de propósito:
 * a Shoppub reenvia (até 5×/15min, documentado), e um erro transitório nosso
 * não deveria custar a atualização de preço pra sempre.
 */
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { ehVendavel } from "@/lib/shoppub/config";
import { ShoppubApiClient, ShoppubApiError } from "@/lib/shoppub/api-client";
import { mapearProduto } from "@/lib/shoppub/mapear-produto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ token: string }>;
}

interface ShoppubWebhookPayload {
  tipo?: string;
  sku?: string;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const { token } = await ctx.params;
  if (!token) return fail("not_found", "token ausente", 404);

  let body: ShoppubWebhookPayload;
  try {
    body = (await req.json()) as ShoppubWebhookPayload;
  } catch {
    return fail("invalid_request", "invalid_json", 400);
  }

  const admin = createAdminClient();
  const { data: integration, error: lookupErr } = await admin
    .from("tenant_integrations")
    .select("id, organization_id, status, oauth_access_token_encrypted, store_metadata")
    .eq("provider", "shoppub")
    .eq("webhook_path_token", token)
    .maybeSingle();

  if (lookupErr) return fail("internal_error", lookupErr.message, 500);
  // Token velho/desconectado — 200 pra parar o retry, sem vazar se o token existiu.
  if (!integration || integration.status !== "healthy") {
    return ok({ accepted: false, reason: "tenant_not_found" });
  }

  // A doc não lista outros "tipo" além de "produto", mas o payload pode
  // crescer — ignorar o que não conhecemos é mais seguro que processar às cegas.
  if (body.tipo !== "produto" || !body.sku) {
    return ok({ accepted: true, ignored: true });
  }

  const subdominio = (integration.store_metadata as { subdominio?: string } | null)?.subdominio;
  const { data: tokenPlano, error: decErr } = await admin.rpc("fn_decrypt_oauth", {
    ciphertext: integration.oauth_access_token_encrypted,
  });
  if (decErr || !tokenPlano || !subdominio) {
    await audit({
      action: "shoppub.webhook_rejected",
      organizationId: integration.organization_id,
      metadata: { reason: "decrypt_failed_or_missing_subdominio", sku: body.sku },
    });
    return fail("internal_error", "decrypt_failed", 500);
  }

  const client = new ShoppubApiClient({ subdominio, token: tokenPlano as string });

  try {
    const produto = await client.obterProduto(body.sku);
    if (!ehVendavel(produto)) {
      return ok({ accepted: true, ignored: true, reason: "produto_pai" });
    }

    // Lista pequena, busca de novo a cada webhook: mais simples que cache, e
    // o custo é uma chamada extra por evento de preço/estoque — a Shoppub
    // não embute nome de categoria no produto (embute fabricante_info, esse
    // sim reaproveitado direto sem chamada nenhuma).
    const categorias = await client.obterCategorias();
    const mapaCategorias = new Map(categorias.map((c) => [c.id, c.nome]));

    const linha = mapearProduto(produto, integration.organization_id, subdominio, mapaCategorias);
    const { error: upsertErr } = await admin
      .from("catalog_products")
      .upsert(linha, { onConflict: "organization_id,codigo" });
    if (upsertErr) {
      return fail("internal_error", upsertErr.message, 500);
    }
  } catch (err) {
    if (err instanceof ShoppubApiError && err.code === "not_found") {
      // Produto sumiu/desativado na Shoppub — decisão do Anderson pra Tiny
      // (mesma doutrina aqui): marca ativo=false, não apaga a linha nem
      // histórico. Sem linha existente ainda, não há o que marcar.
      await admin
        .from("catalog_products")
        .update({ ativo: false })
        .eq("organization_id", integration.organization_id)
        .eq("codigo", body.sku);
      return ok({ accepted: true, marked_inactive: true });
    }
    const detalhe = err instanceof Error ? err.message : "erro";
    await audit({
      action: "shoppub.webhook_rejected",
      organizationId: integration.organization_id,
      metadata: { reason: "fetch_produto_failed", sku: body.sku, detalhe },
    });
    return fail("upstream_error", detalhe, 502);
  }

  await audit({
    action: "shoppub.webhook_received",
    organizationId: integration.organization_id,
    resourceType: "catalog_product",
    metadata: { sku: body.sku },
  });

  return ok({ accepted: true });
}
