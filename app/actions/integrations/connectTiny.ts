"use server";

/**
 * Server Action: inicia o fluxo OAuth da Tiny pra organização ativa.
 * Mesmo padrão de `connectNuvemshop.ts`.
 */

import { supportWriteError, authenticatedSessionId } from "@/lib/impersonate/support";
import { redirect } from "next/navigation";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { buildAuthorizeUrl } from "@/lib/tiny/oauth";
import { getConfig } from "@/lib/tiny/config";
import { issueState } from "@/lib/tiny/state";

export type ConnectResult = { ok: false; error: "auth_required" | "no_active_org" | "forbidden" | "not_configured" };

export async function connectTiny(): Promise<ConnectResult> {
  const user = await loadAuthUser();
  if (!user) return { ok: false, error: "auth_required" };

  if (supportWriteError(user.support)) return { ok: false, error: "forbidden" };
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return { ok: false, error: "no_active_org" };

  if (activeOrg.role !== "admin" && !user.is_platform_admin) {
    return { ok: false, error: "forbidden" };
  }

  const cfg = getConfig();
  if (!cfg) return { ok: false, error: "not_configured" };

  const state = issueState(activeOrg.orgId, {
    userId: user.id,
    authSessionId: await authenticatedSessionId(),
  });
  const url = buildAuthorizeUrl({ clientId: cfg.clientId, redirectUri: cfg.redirectUri, state });
  redirect(url);
}
