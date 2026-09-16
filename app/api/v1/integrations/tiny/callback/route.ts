import { supportCallbackWriteAllowed } from "@/lib/impersonate/support";
/**
 * GET /api/v1/integrations/tiny/callback
 *
 * OAuth callback da Tiny. Valida state, troca code por token, criptografa
 * access+refresh token, faz upsert em tenant_integrations.
 *
 * Diferente do Nuvemshop: a Tiny não tem API de registro de webhook — a
 * sincronização é via cron (`app/api/v1/cron/tiny-stock-sync`), não push.
 * Por isso não há loop de "registrar webhooks" aqui.
 */

import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/tiny/config";
import { exchangeCodeForToken } from "@/lib/tiny/oauth";
import { verifyState } from "@/lib/tiny/state";

export const dynamic = "force-dynamic";

function redirectTo(path: string): NextResponse {
  const base = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return NextResponse.redirect(new URL(path, base));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  const cfg = getConfig();
  if (!cfg) {
    return redirectTo(`/app/integrations/tiny?error=not_configured`);
  }

  const state = verifyState(stateParam);
  if (!state) {
    await audit({ action: "tiny.oauth_failed", metadata: { reason: "invalid_state" } });
    return redirectTo(`/app/integrations/tiny?error=invalid_state`);
  }

  if (!code) {
    await audit({
      action: "tiny.oauth_failed",
      organizationId: state.orgId,
      metadata: { reason: "missing_code" },
    });
    return redirectTo(`/app/integrations/tiny?error=missing_code`);
  }

  if (!(await supportCallbackWriteAllowed(state.orgId, state.userId, state.authSessionId))) {
    return redirectTo("/app/integrations/tiny?error=invalid_state");
  }

  const tokenRes = await exchangeCodeForToken(code, cfg);
  if (!tokenRes.ok) {
    await audit({
      action: "tiny.oauth_failed",
      organizationId: state.orgId,
      metadata: { reason: tokenRes.error, status: tokenRes.status ?? null },
    });
    return redirectTo(`/app/integrations/tiny?error=${tokenRes.error}`);
  }

  const { accessToken, refreshToken, expiresAt } = tokenRes;
  const admin = createAdminClient();

  const encryptedAccess = await admin.rpc("fn_encrypt_oauth", { plaintext: accessToken });
  const encryptedRefresh = await admin.rpc("fn_encrypt_oauth", { plaintext: refreshToken });
  if (encryptedAccess.error || !encryptedAccess.data || encryptedRefresh.error || !encryptedRefresh.data) {
    await audit({
      action: "tiny.oauth_failed",
      organizationId: state.orgId,
      metadata: {
        reason: "encrypt_failed",
        error: encryptedAccess.error?.message ?? encryptedRefresh.error?.message ?? "no_data",
      },
    });
    return redirectTo(`/app/integrations/tiny?error=encrypt_failed`);
  }

  // Sem webhook nesta integração — a Tiny não registra push. `webhook_secret_encrypted`
  // é NOT NULL na tabela, então gravamos um valor opaco não usado (nunca lido de
  // volta): mais simples que alterar a constraint da tabela genérica por causa de
  // um provider sem webhook.
  const opaqueWebhookSecret = await admin.rpc("fn_encrypt_oauth", {
    plaintext: "tiny-nao-usa-webhook",
  });
  if (opaqueWebhookSecret.error || !opaqueWebhookSecret.data) {
    await audit({
      action: "tiny.oauth_failed",
      organizationId: state.orgId,
      metadata: { reason: "encrypt_failed", error: opaqueWebhookSecret.error?.message ?? "no_data" },
    });
    return redirectTo(`/app/integrations/tiny?error=encrypt_failed`);
  }

  const { data: integration, error: upsertErr } = await admin
    .from("tenant_integrations")
    .upsert(
      {
        organization_id: state.orgId,
        provider: "tiny",
        oauth_access_token_encrypted: encryptedAccess.data,
        oauth_refresh_token_encrypted: encryptedRefresh.data,
        expires_at: new Date(expiresAt).toISOString(),
        scopes: ["openid"],
        status: "healthy",
        store_metadata: {},
        // Sem valor explícito: cai no default da coluna
        // (`encode(gen_random_bytes(24), 'hex')`) — string vazia arriscava
        // colidir com outra integração sem webhook no futuro, já que a
        // coluna não tem UNIQUE mas é pensada pra ser um token de verdade.
        webhook_secret_encrypted: opaqueWebhookSecret.data,
        webhook_subscriptions: {},
        last_sync_at: null,
      },
      { onConflict: "organization_id,provider" },
    )
    .select("id")
    .single();

  if (upsertErr) {
    await audit({
      action: "tiny.oauth_failed",
      organizationId: state.orgId,
      metadata: { reason: "db_upsert_failed", error: upsertErr.message },
    });
    return redirectTo(`/app/integrations/tiny?error=db_upsert_failed`);
  }

  await audit({
    actorUserId: state.userId,
    actorAuthSessionId: state.authSessionId,
    action: "tiny.connected",
    organizationId: state.orgId,
    resourceType: "tenant_integration",
    resourceId: integration?.id,
    requestId: randomUUID(),
    metadata: {},
  });

  return redirectTo(`/app/integrations/tiny?ok=1`);
}
