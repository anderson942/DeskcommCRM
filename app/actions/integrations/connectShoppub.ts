"use server";

/**
 * Server Action: conecta a Shoppub da organização ativa.
 *
 * Diferente de `connectTiny`/`connectNuvemshop` (OAuth, redireciona pro
 * provedor): a Shoppub usa um token estático que o próprio operador gera na
 * área admin da loja dele e cola aqui — não há redirect nenhum. O token
 * passa DIRETO daqui pro banco criptografado; nunca aparece em log, nunca
 * atravessa uma conversa.
 */

import { revalidatePath } from "next/cache";
import { supportWriteError } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizarSubdominio } from "@/lib/shoppub/config";
import { ShoppubApiClient, ShoppubApiError } from "@/lib/shoppub/api-client";

export type ConnectShoppubResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "auth_required"
        | "no_active_org"
        | "forbidden"
        | "subdominio_invalido"
        | "token_vazio"
        | "token_invalido"
        | "falha_ao_testar"
        | "falha_ao_criptografar"
        | "db_error";
    };

export async function connectShoppub(formData: FormData): Promise<ConnectShoppubResult> {
  const user = await loadAuthUser();
  if (!user) return { ok: false, error: "auth_required" };

  if (supportWriteError(user.support)) return { ok: false, error: "forbidden" };
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return { ok: false, error: "no_active_org" };

  if (activeOrg.role !== "admin" && !user.is_platform_admin) {
    return { ok: false, error: "forbidden" };
  }

  const subdominio = normalizarSubdominio(String(formData.get("subdominio") ?? ""));
  if (!subdominio) return { ok: false, error: "subdominio_invalido" };

  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { ok: false, error: "token_vazio" };

  // Testa a credencial ANTES de gravar — falhar cedo é melhor que salvar um
  // token errado e só descobrir na próxima sincronização, sem operador na tela.
  try {
    await new ShoppubApiClient({ subdominio, token }).listarProdutos({ page: 1 });
  } catch (err) {
    if (err instanceof ShoppubApiError && err.code === "unauthorized") {
      return { ok: false, error: "token_invalido" };
    }
    return { ok: false, error: "falha_ao_testar" };
  }

  const admin = createAdminClient();

  const encryptedToken = await admin.rpc("fn_encrypt_oauth", { plaintext: token });
  // Sem webhook assinado nesta integração — `webhook_secret_encrypted` é
  // NOT NULL na tabela genérica; grava um valor opaco nunca lido de volta,
  // mesmo padrão já usado pela Tiny (que também não tem HMAC).
  const encryptedWebhookPlaceholder = await admin.rpc("fn_encrypt_oauth", {
    plaintext: "shoppub-sem-hmac",
  });
  if (encryptedToken.error || !encryptedToken.data || encryptedWebhookPlaceholder.error || !encryptedWebhookPlaceholder.data) {
    return { ok: false, error: "falha_ao_criptografar" };
  }

  // `webhook_path_token` fica de fora do corpo de propósito: no INSERT o
  // DEFAULT da coluna gera um novo; numa RECONEXÃO (upsert em cima da linha
  // existente) omitir a chave preserva o valor atual — é o que mantém a URL
  // já cadastrada na área de webhooks da Shoppub funcionando sem reconfigurar.
  const { data: integration, error: upsertErr } = await admin
    .from("tenant_integrations")
    .upsert(
      {
        organization_id: activeOrg.orgId,
        provider: "shoppub",
        oauth_access_token_encrypted: encryptedToken.data,
        webhook_secret_encrypted: encryptedWebhookPlaceholder.data,
        store_metadata: { subdominio },
        status: "healthy",
        status_reason: null,
      },
      { onConflict: "organization_id,provider" },
    )
    .select("id")
    .single();

  if (upsertErr) {
    await audit({
      action: "shoppub.connect_failed",
      organizationId: activeOrg.orgId,
      metadata: { reason: upsertErr.message },
    });
    return { ok: false, error: "db_error" };
  }

  await audit({
    action: "shoppub.connected",
    organizationId: activeOrg.orgId,
    actorUserId: user.id,
    resourceType: "tenant_integration",
    resourceId: integration?.id,
  });

  revalidatePath("/app/integrations/shoppub");
  return { ok: true };
}
