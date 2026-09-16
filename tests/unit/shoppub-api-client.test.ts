import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShoppubApiClient, ShoppubApiError } from "@/lib/shoppub/api-client";

/**
 * O redirect que derrubava o token — medido em produção (2026-09-16).
 *
 * A loja tem domínio próprio SEM `www` cadastrado no cliente Shoppub: pedir
 * `outlet360.com.br` responde 301 pra `www.outlet360.com.br`. O `fetch`
 * nativo (e o `curl -L`) tratam essa troca de HOST como troca de ORIGEM e
 * derrubam o header `Authorization` no segundo request — comportamento
 * correto num caso genérico (redirect pra domínio de terceiro), errado
 * quando os dois hosts são a MESMA loja. O operador via "token recusado"
 * com um token que funcionava direto contra o host final.
 */
describe("ShoppubApiClient — redirect não derruba o Authorization", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("segue um 301 de troca de host reanexando o Authorization", async () => {
    const chamadas: Array<{ url: string; auth: string | null }> = [];
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization ?? null });
      if (url.startsWith("https://outlet360.com.br")) {
        return new Response(null, {
          status: 301,
          headers: { location: "https://www.outlet360.com.br/api/v1/produtos/?page=1" },
        });
      }
      return new Response(JSON.stringify({ count: 1, next: null, previous: null, results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = new ShoppubApiClient({ subdominio: "outlet360.com.br", token: "abc123" });
    const pagina = await client.listarProdutos({ page: 1 });

    expect(pagina.count).toBe(1);
    expect(chamadas).toHaveLength(2);
    // A parte que importa: o SEGUNDO request (pós-redirect) leva o MESMO
    // Authorization do primeiro — é exatamente o que o fetch nativo NÃO faz
    // sozinho numa troca de host.
    expect(chamadas[0]!.auth).toBe("Token abc123");
    expect(chamadas[1]!.auth).toBe("Token abc123");
    expect(chamadas[1]!.url).toBe("https://www.outlet360.com.br/api/v1/produtos/?page=1");
  });

  it("desiste depois de muitos redirects em vez de entrar em loop", async () => {
    global.fetch = vi.fn(async () =>
      new Response(null, { status: 301, headers: { location: "https://outlet360.com.br/api/v1/produtos/?page=1" } }),
    ) as unknown as typeof fetch;

    const client = new ShoppubApiClient({ subdominio: "outlet360.com.br", token: "abc123" });
    await expect(client.listarProdutos({ page: 1 })).rejects.toThrow(ShoppubApiError);
  });

  it("um 401 de verdade (sem redirect) ainda vira 'unauthorized'", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ detail: "Token inválido." }), { status: 401 }),
    ) as unknown as typeof fetch;

    const client = new ShoppubApiClient({ subdominio: "outlet360.com.br", token: "errado" });
    await expect(client.listarProdutos({ page: 1 })).rejects.toMatchObject({ code: "unauthorized" });
  });
});
