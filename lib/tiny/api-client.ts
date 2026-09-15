/**
 * Cliente REST da API v3 da Tiny (Olist ERP).
 *
 * Endpoints verificados contra api-docs.erp.olist.com (2026-09-15):
 *  - GET /produtos          → { itens: [...], paginacao: { limit, offset, total } }
 *  - GET /estoque/{idProduto} → { saldo, reservado, disponivel, depositos: [...] }
 *
 * ⚠️ O saldo de estoque NÃO vem na listagem de produtos — é uma chamada por
 * produto. Por isso o sync (`app/api/v1/cron/tiny-stock-sync`) só busca
 * estoque dos produtos que MUDARAM desde o último sync (filtro `dataAlteracao`
 * em `/produtos`), não do catálogo inteiro a cada rodada — senão N produtos
 * viram N chamadas a cada 5 minutos, e o rate limit (por conta, não por app)
 * estoura rápido numa loja com catálogo grande.
 */

import { APP_USER_AGENT, TINY_API_BASE } from "./config";

export class TinyApiError extends Error {
  status: number;
  code: string;
  body: string;

  constructor(status: number, code: string, body: string, message?: string) {
    super(message ?? `Tiny API ${status} (${code})`);
    this.name = "TinyApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export interface TinyProduto {
  id: number;
  sku: string;
  descricao: string;
  tipo: string;
  situacao: "A" | "I" | "E";
  dataCriacao: string;
  dataAlteracao: string;
  unidade: string;
  gtin: string | null;
  precos: {
    preco: number;
    precoPromocional: number | null;
    precoCusto: number | null;
    precoCustoMedio: number | null;
  };
}

export interface TinyProdutosPage {
  itens: TinyProduto[];
  paginacao: { limit: number; offset: number; total: number };
}

export interface TinyEstoque {
  id: number;
  saldo: number;
  reservado: number;
  disponivel: number;
}

interface ApiClientOptions {
  accessToken: string;
}

export class TinyApiClient {
  private readonly accessToken: string;

  constructor({ accessToken }: ApiClientOptions) {
    if (!accessToken) throw new Error("TinyApiClient: accessToken required");
    this.accessToken = accessToken;
  }

  private url(path: string, params?: Record<string, string | number | undefined>): string {
    const url = new URL(`${TINY_API_BASE}${path.startsWith("/") ? path : `/${path}`}`);
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
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "User-Agent": APP_USER_AGENT,
          Accept: "application/json",
        },
        cache: "no-store",
      });
    } catch (err) {
      throw new TinyApiError(0, "network_error", String((err as Error).message));
    }

    const text = await res.text();
    if (!res.ok) {
      const code =
        res.status === 401
          ? "unauthorized"
          : res.status === 403
            ? "forbidden"
            : res.status === 404
              ? "not_found"
              : res.status === 429
                ? "rate_limited"
                : res.status >= 500
                  ? "upstream_error"
                  : "request_failed";
      throw new TinyApiError(res.status, code, text);
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new TinyApiError(res.status, "invalid_json", text);
    }
  }

  /**
   * Uma página de produtos. `dataAlteracao` filtra só o que mudou desde X —
   * é o que mantém o sync incremental barato depois da primeira carga.
   */
  listarProdutos(opts: {
    limit?: number;
    offset?: number;
    dataAlteracao?: string;
  }): Promise<TinyProdutosPage> {
    return this.request<TinyProdutosPage>("/produtos", opts);
  }

  obterEstoque(idProduto: number): Promise<TinyEstoque> {
    return this.request<TinyEstoque>(`/estoque/${idProduto}`);
  }
}
