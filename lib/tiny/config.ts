/**
 * Integração Tiny (ERP) — configuração estática + credenciais vindas do env.
 *
 * Mesmo padrão de `lib/nuvemshop/config.ts`: `getConfig()` devolve `null`
 * quando falta qualquer credencial, e quem chama mostra o card "configure
 * o .env" — a integração ativa sozinha assim que as chaves existirem, sem
 * mudança de código.
 *
 * ⚠️ `NEXT_PUBLIC_APP_URL` vem de `@/lib/env` (`env.NEXT_PUBLIC_APP_URL`),
 * NUNCA de `process.env.NEXT_PUBLIC_APP_URL` direto neste arquivo. O Next
 * "queima" no build qualquer `process.env.NEXT_PUBLIC_*` que apareça como
 * texto literal no código-fonte — na imagem Docker genérica isso vira o
 * placeholder de build (`https://build-placeholder.invalid`), não o domínio
 * real do self-host. `lib/env.ts` escapa disso lendo o objeto `process.env`
 * inteiro de uma vez (sem o padrão textual `.NEXT_PUBLIC_X`), então ele
 * resolve em runtime de verdade. Medido: o redirect_uri do OAuth saía como
 * `https://placeholder.invalid/...` e a Tiny recusava com "Invalid parameter:
 * redirect_uri".
 */

import { env } from "@/lib/env";

export const TINY_ACCOUNTS_BASE = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect";
export const TINY_API_BASE = "https://api.tiny.com.br/public-api/v3";
export const APP_USER_AGENT = "DeskcommCRM-Outlet360";

export interface TinyConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getConfig(): TinyConfig | null {
  const clientId = process.env.TINY_CLIENT_ID || "";
  const clientSecret = process.env.TINY_CLIENT_SECRET || "";
  const appUrl = env.NEXT_PUBLIC_APP_URL || "";
  if (!clientId || !clientSecret || !appUrl) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${appUrl.replace(/\/$/, "")}/api/v1/integrations/tiny/callback`,
  };
}

export function isConfigured(): boolean {
  return getConfig() !== null;
}

/**
 * Situação do produto na Tiny. `A` = ativo, `I` = inativo, `E` = excluído.
 * Qualquer situação diferente de `A` desativa o produto no catálogo local —
 * decisão do Anderson (2026-09-15): sumir da oferta da IA, sem apagar linha.
 */
export const SITUACOES_ATIVAS = new Set(["A"]);

/** Intervalo do cron de sincronização — 5 minutos, decisão do Anderson. */
export const SYNC_INTERVAL_MINUTES = 5;
