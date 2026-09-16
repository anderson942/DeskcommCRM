/**
 * GET /api/v1/media/fetch-external?url=... — baixa uma imagem de fora (site
 * arrastado de outra aba pro composer) e devolve os bytes.
 *
 * Por que o servidor busca em vez do browser buscar direto: o browser esbarra
 * em CORS sempre que o CDN de origem não devolve `Access-Control-Allow-Origin`
 * — e a maioria não devolve, porque a imagem nunca foi pensada pra ser lida
 * por JS de outro domínio, só exibida num `<img>`. Fetch servidor-a-servidor
 * não tem essa restrição (CORS é regra de browser).
 *
 * Anti-SSRF: mesmo par de guards do `call_webhook` — textual primeiro (barato,
 * recusa esquema/IP literal privado), depois resolve o DNS e julga o IP de
 * verdade (`assertDestinoResolvidoSeguro`). Sem isso, "arraste essa foto"
 * virava "busque uma URL interna qualquer da rede do compose pra mim".
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { assertDestinoResolvidoSeguro } from "@/lib/automation/outbound-ip";
import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";
import { MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";

export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 10_000;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authUser = await loadAuthUser();
  const activeOrg = authUser ? await resolveActiveOrg(authUser) : null;
  if (!activeOrg) {
    return fail("no_active_org", "No active organization.", 403, { requestId });
  }

  const url = new URL(req.url).searchParams.get("url");
  if (!url) {
    return fail("validation_failed", "Parâmetro 'url' obrigatório.", 422, { requestId });
  }

  try {
    assertSafeOutboundUrl(url);
    await assertDestinoResolvidoSeguro(new URL(url).hostname);
  } catch (err) {
    return fail("validation_failed", (err as Error).message, 422, { requestId });
  }

  let res: Response;
  try {
    res = await fetch(url, {
      // Nunca seguir 3xx sozinho — um redirect pode reapontar para dentro da
      // rede interna depois que a URL original já passou no guard acima.
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return fail("upstream_error", `Falha ao buscar a imagem: ${(err as Error).message}`, 502, { requestId });
  }
  if (!res.ok) {
    return fail("upstream_error", `A origem respondeu ${res.status}.`, 502, { requestId });
  }

  const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!mime.startsWith("image/")) {
    return fail("unsupported_media_type", "A URL arrastada não é uma imagem.", 415, { requestId });
  }

  const declarado = Number(res.headers.get("content-length") ?? 0);
  if (declarado > MAX_MEDIA_BYTES) {
    return fail("payload_too_large", "Imagem acima de 50MB.", 413, { requestId });
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_MEDIA_BYTES) {
    return fail("payload_too_large", "Imagem acima de 50MB.", 413, { requestId });
  }
  if (buffer.byteLength === 0) {
    return fail("validation_failed", "Imagem vazia.", 422, { requestId });
  }

  return new Response(buffer, {
    status: 200,
    headers: { "Content-Type": mime, "Cache-Control": "private, no-store" },
  });
}
