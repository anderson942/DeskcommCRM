/**
 * Tela de status da integração Shoppub.
 *
 * Dois estados (não três como a Tiny): não existe "não configurada" — a
 * Shoppub não depende de nenhuma credencial de app em `.env`, o token é da
 * loja e entra pelo formulário.
 *   1. not_connected — sem linha em tenant_integrations: mostra o formulário.
 *   2. connected     — linha existe com status=healthy: mostra a URL do
 *      webhook (pra cadastrar na área admin da Shoppub) + contagem do catálogo.
 */

import { Package } from "@/lib/ui/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { ConnectForm, DisconnectButton } from "./_components/ConnectForm";
import { CopyWebhookUrl } from "./_components/CopyWebhookUrl";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

interface IntegrationRow {
  id: string;
  status: string;
  last_sync_at: string | null;
  webhook_path_token: string;
  store_metadata: { subdominio?: string } | null;
}

async function loadIntegration(orgId: string): Promise<IntegrationRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("tenant_integrations")
    .select("id, status, last_sync_at, webhook_path_token, store_metadata")
    .eq("organization_id", orgId)
    .eq("provider", "shoppub")
    .maybeSingle();
  return (data as IntegrationRow | null) ?? null;
}

async function contarProdutosSincronizados(orgId: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("catalog_products")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("origem", "shoppub");
  return count ?? 0;
}

export default async function ShoppubIntegrationPage() {
  const user = await loadAuthUser();
  const activeOrg = user ? await resolveActiveOrg(user) : null;
  const idioma = normalizarIdioma(user?.locale ?? null);

  const integration = activeOrg ? await loadIntegration(activeOrg.orgId) : null;
  const produtosSincronizados =
    activeOrg && integration?.status === "healthy" ? await contarProdutosSincronizados(activeOrg.orgId) : 0;

  const isAdmin = activeOrg?.role === "admin" || (user?.is_platform_admin === true && !user.support);
  const webhookUrl = integration
    ? `${env.NEXT_PUBLIC_APP_URL}/api/v1/webhooks/shoppub/${integration.webhook_path_token}`
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-start gap-4">
        <div className="rounded-md border border-border bg-surface p-3">
          <Package size={28} weight="duotone" className="text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Shoppub</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {traduzir(
              "Sincroniza preço e estoque da sua loja em tempo real, por webhook — é o preço que o cliente vê de verdade.",
              idioma,
            )}
          </p>
        </div>
      </header>

      {!integration || integration.status === "disconnected" ? (
        <Card>
          <CardHeader>
            <CardTitle>{traduzir("Conectar Shoppub", idioma)}</CardTitle>
            <CardDescription>
              {traduzir("Cole o subdomínio da loja e o token da API — sem redirecionamento.", idioma)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConnectForm disabled={!isAdmin} />
            {!isAdmin ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {traduzir("Somente administradores podem conectar integrações.", idioma)}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                {traduzir("Conectado", idioma)}
                <Badge variant="secondary">{integration.status}</Badge>
              </CardTitle>
              <CardDescription>
                {traduzir("última sincronização completa:", idioma)}{" "}
                {integration.last_sync_at
                  ? new Date(integration.last_sync_at).toLocaleString(tagDeIdioma(idioma))
                  : traduzir("ainda não completou a primeira carga", idioma)}
              </CardDescription>
            </div>
            {isAdmin ? <DisconnectButton /> : null}
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <span className="font-medium">{traduzir("Produtos sincronizados:", idioma)}</span>{" "}
              <span className="text-muted-foreground">{produtosSincronizados}</span>
            </div>
            {webhookUrl && (
              <div className="space-y-1.5">
                <p className="font-medium">{traduzir("URL do webhook — cadastre na Shoppub:", idioma)}</p>
                <CopyWebhookUrl url={webhookUrl} />
                <p className="text-xs text-muted-foreground">
                  {traduzir(
                    "Área admin da Shoppub → Configurações → Webhooks → Produto. Sem isso, o preço só atualiza na sincronização periódica, não na hora que você mexe no preço.",
                    idioma,
                  )}
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {traduzir(
                "Produtos vindos da Shoppub aparecem no catálogo (Produtos) marcados com essa origem — preço e estoque não são editáveis manualmente, eles vêm da Shoppub.",
                idioma,
              )}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
