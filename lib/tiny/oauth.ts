/**
 * Tiny ERP (Olist) OAuth2 helpers.
 *
 * Endpoints verificados contra api-docs.erp.olist.com (2026-09-15):
 *  - Authorize: https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth
 *  - Token:     https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token
 *  - Header:    Authorization: Bearer {access_token}
 *
 * ⚠️ Diferente da Nuvemshop (token não expira): aqui o access_token expira em
 * 4 HORAS e o refresh_token vale só 1 DIA. Isso não é detalhe — se o cron de
 * sync (a cada 5min) parar de rodar por mais de 24h, o refresh token morre e
 * a única saída é reconectar manualmente pela tela. É por isso que TODA
 * chamada de sync deve renovar o token quando estiver perto de expirar, não
 * só quando falhar.
 */

import { TINY_ACCOUNTS_BASE, APP_USER_AGENT, type TinyConfig } from "./config";

export interface AuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
}

export function buildAuthorizeUrl({ clientId, redirectUri, state }: AuthorizeUrlInput): string {
  const url = new URL(`${TINY_ACCOUNTS_BASE}/auth`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid");
  url.searchParams.set("state", state);
  return url.toString();
}

export interface TokenSuccess {
  ok: true;
  accessToken: string;
  refreshToken: string;
  /** Timestamp (ms) em que o access_token expira — sempre com margem de segurança já aplicada. */
  expiresAt: number;
}

export interface TokenFailure {
  ok: false;
  error: string;
  status?: number;
  raw?: string;
}

export type TokenResult = TokenSuccess | TokenFailure;

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

/** Margem de segurança: renova o token 5 minutos antes de expirar de verdade. */
const MARGEM_MS = 5 * 60 * 1000;

async function postToken(body: URLSearchParams): Promise<TokenResult> {
  let res: Response;
  try {
    res = await fetch(`${TINY_ACCOUNTS_BASE}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": APP_USER_AGENT,
      },
      body,
      cache: "no-store",
    });
  } catch (err) {
    return { ok: false, error: "network_error", raw: (err as Error).message };
  }

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: "token_exchange_failed", status: res.status, raw: text };
  }

  let parsed: RawTokenResponse;
  try {
    parsed = JSON.parse(text) as RawTokenResponse;
  } catch {
    return { ok: false, error: "invalid_token_response", raw: text };
  }

  if (!parsed.access_token || !parsed.refresh_token) {
    return { ok: false, error: "invalid_token_response", raw: text };
  }

  const expiresInMs = (parsed.expires_in ?? 4 * 60 * 60) * 1000;
  return {
    ok: true,
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt: Date.now() + expiresInMs - MARGEM_MS,
  };
}

export function exchangeCodeForToken(code: string, cfg: TinyConfig): Promise<TokenResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    code,
  });
  return postToken(body);
}

export function refreshAccessToken(refreshToken: string, cfg: TinyConfig): Promise<TokenResult> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
  });
  return postToken(body);
}
