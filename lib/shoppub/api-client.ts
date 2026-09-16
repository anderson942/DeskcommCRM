/**
 * Cliente REST da API v1 do Shoppub.
 *
 * Verificado direto contra https://shoppub.readme.io/reference (2026-09-16):
 *  - GET /produtos/       → { count, next, previous, results: [...] }
 *  - GET /produto/{sku}/  → um produto, com preco_de/preco_por/estoque/etc.
 *
 * Auth: header `Authorization: Token {token}` — token estático da LOJA, sem
 * OAuth, sem expiração documentada (diferente da Tiny).
 */

import { baseUrlFor } from "./config";

export class ShoppubApiError extends Error {
  status: number;
  code: string;
  body: string;

  constructor(status: number, code: string, body: string, message?: string) {
    super(message ?? `Shoppub API ${status} (${code})`);
    this.name = "ShoppubApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export interface ShoppubProduto {
  id: number;
  sku: string;
  nome: string;
  slug: string;
  ativo: boolean;
  /** Produto agrupador de variações — nunca vendável (ver `ehVendavel`). */
  is_wrapper?: boolean;
  parent?: number | null;
  preco_de: number;
  preco_por: number;
  preco_custo?: number | null;
  estoque: number;
  estoque_reserva: number;
  extra_fields?: { produto_vendavel?: boolean } | null;
}

export interface ShoppubProdutosPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: ShoppubProduto[];
}

interface ClientOpts {
  subdominio: string;
  token: string;
}

export class ShoppubApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor({ subdominio, token }: ClientOpts) {
    if (!subdominio || !token) throw new Error("ShoppubApiClient: subdominio e token são obrigatórios");
    this.baseUrl = baseUrlFor(subdominio);
    this.token = token;
  }

  private url(path: string, params?: Record<string, string | number | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  private async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.url(path, params), {
        method: "GET",
        headers: { Authorization: `Token ${this.token}`, Accept: "application/json" },
        cache: "no-store",
      });
    } catch (err) {
      throw new ShoppubApiError(0, "network_error", String((err as Error).message));
    }

    const text = await res.text();
    if (!res.ok) {
      const code =
        res.status === 401
          ? "unauthorized"
          : res.status === 404
            ? "not_found"
            : res.status === 429
              ? "rate_limited"
              : res.status >= 500
                ? "upstream_error"
                : "request_failed";
      throw new ShoppubApiError(res.status, code, text);
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ShoppubApiError(res.status, "invalid_json", text);
    }
  }

  /** Uma página de produtos. `minData`/`maxData` filtram por data de alteração. */
  listarProdutos(opts: {
    page?: number;
    minData?: string;
    maxData?: string;
    ativo?: number;
  } = {}): Promise<ShoppubProdutosPage> {
    return this.request<ShoppubProdutosPage>("/produtos/", {
      page: opts.page,
      min_data: opts.minData,
      max_data: opts.maxData,
      ativo: opts.ativo,
    });
  }

  obterProduto(sku: string): Promise<ShoppubProduto> {
    return this.request<ShoppubProduto>(`/produto/${encodeURIComponent(sku)}/`);
  }
}
