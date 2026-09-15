/**
 * Tela de status da integração Tiny.
 *
 * Três estados, igual ao Nuvemshop:
 *   1. not_configured — env vazio: mostra card "configure o .env".
 *   2. not_connected  — env ok, sem linha em tenant_integrations: mostra Conectar.
 *   3. connected      — linha existe com status=healthy: mostra info + Desconectar.
 *
 * Diferente do Nuvemshop: sem contagem de webhooks (a Tiny não tem push) —
 * em vez disso mostra quantos produtos do catálogo vieram da Tiny.
 */

import { Package } from "@/lib/ui/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/tiny/config";
import { ConnectButton, DisconnectButton } from "./_components/ConnectButton";
import { StatusToast } from "./_components/StatusToast";
import { Suspense } from "react";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

interface IntegrationRow {
  id: string;
  status: string;
  last_sync_at: string | null;
}

async function loadIntegration(orgId: string): Promise<IntegrationRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("tenant_integrations")
    .select("id, status, last_sync_at")
    .eq("organization_id", orgId)
    .eq("provider", "tiny")
    .maybeSingle();
  return (data as IntegrationRow | null) ?? null;
}

async function contarProdutosSincronizados(orgId: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("catalog_products")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("origem", "tiny");
  return count ?? 0;
}

export default async function TinyIntegrationPage() {
  const user = await loadAuthUser();
  const activeOrg = user ? await resolveActiveOrg(user) : null;
  const configured = isConfigured();
  const idioma = normalizarIdioma(user?.locale ?? null);

  const integration = activeOrg && configured ? await loadIntegration(activeOrg.orgId) : null;
  const produtosSincronizados =
    activeOrg && integration?.status === "healthy" ? await contarProdutosSincronizados(activeOrg.orgId) : 0;

  const isAdmin = activeOrg?.role === "admin" || (user?.is_platform_admin === true && !user.support);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <Suspense fallback={null}>
        <StatusToast />
      </Suspense>

      <header className="flex items-start gap-4">
        <div className="rounded-md border border-border bg-surface p-3">
          <Package size={28} weight="duotone" className="text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Tiny</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {traduzir(
              "Sincroniza produtos, preços e estoque do seu ERP a cada 5 minutos.",
              idioma,
            )}
          </p>
        </div>
      </header>

      {!configured ? (
        <Card>
          <CardHeader>
            <CardTitle>{traduzir("Integração não configurada", idioma)}</CardTitle>
            <CardDescription>
              {traduzir("Configure", idioma)}{" "}
              <code className="rounded-md bg-muted px-1 py-0.5 text-xs">TINY_CLIENT_ID</code>{" "}
              {traduzir("e", idioma)}{" "}
              <code className="rounded-md bg-muted px-1 py-0.5 text-xs">TINY_CLIENT_SECRET</code>{" "}
              {traduzir("em", idioma)}{" "}
              <code className="rounded-md bg-muted px-1 py-0.5 text-xs">.env</code>{" "}
              {traduzir("para ativar a integração.", idioma)}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {traduzir("Cadastre o app em", idioma)}{" "}
            <a
              className="underline"
              href="https://api-docs.erp.olist.com/"
              target="_blank"
              rel="noreferrer"
            >
              api-docs.erp.olist.com
            </a>
            .
          </CardContent>
        </Card>
      ) : !integration || integration.status === "disconnected" ? (
        <Card>
          <CardHeader>
            <CardTitle>{traduzir("Conectar Tiny", idioma)}</CardTitle>
            <CardDescription>
              {traduzir("Você será redirecionado para autorizar o app na sua conta Tiny.", idioma)}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ConnectButton disabled={!isAdmin} />
            {!isAdmin ? (
              <p className="text-xs text-muted-foreground">
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
                {traduzir("última sync:", idioma)}{" "}
                {integration.last_sync_at
                  ? new Date(integration.last_sync_at).toLocaleString(tagDeIdioma(idioma))
                  : traduzir("ainda não rodou", idioma)}
              </CardDescription>
            </div>
            {isAdmin ? <DisconnectButton /> : null}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="font-medium">{traduzir("Produtos sincronizados:", idioma)}</span>{" "}
              <span className="text-muted-foreground">{produtosSincronizados}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {traduzir(
                "Produtos vindos da Tiny aparecem no catálogo (Produtos) marcados com essa origem — preço e estoque não são editáveis manualmente, eles vêm da Tiny a cada sincronização.",
                idioma,
              )}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
