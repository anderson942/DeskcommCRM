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
  /** IDs — resolvidos pra nome via `obterCategorias()` + `mapaCategorias`. */
  categorias?: number[];
  fabricante?: number | null;
  /** Já vem EMBUTIDO na própria listagem — não precisa de chamada extra por produto. */
  fabricante_info?: { id: number; nome: string } | null;
}

export interface ShoppubProdutosPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: ShoppubProduto[];
}

export interface ShoppubCategoria {
  id: number;
  nome: string;
  slug: string;
  is_departamento: boolean;
  parent: number | null;
  ativo: boolean;
}

interface ShoppubCategoriasPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: ShoppubCategoria[];
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

  /**
   * Segue redirect (301/302/303/307/308) À MÃO, reanexando o Authorization em
   * cada salto.
   *
   * ⚠️ O `fetch` (nativo, undici, e o curl com `-L`) DERRUBA o header
   * `Authorization` quando o redirect troca de ORIGEM — medido em produção
   * (2026-09-16): a loja tem domínio próprio SEM `www` cadastrado com esse
   * cliente Shoppub, então `outlet360.com.br` responde 301 pra
   * `www.outlet360.com.br` (host DIFERENTE = origem diferente), e o segundo
   * request chegava sem token nenhum — `{"detail":"As credenciais de
   * autenticação não foram fornecidas."}`, com o MESMO token que funciona
   * direto contra `www.outlet360.com.br`. A mensagem que chegava pro
   * operador ("token recusado") apontava pro lugar errado: o token estava
   * certo, o problema era o fetch tratando a troca de host como razão de
   * segurança pra não repassar a credencial — que é o comportamento CERTO
   * do fetch num caso genérico (redirect pra domínio de terceiro), só que
   * aqui os dois hosts são a MESMA loja.
   */
  private async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    let url = this.url(path, params);
    let res: Response;
    const MAX_REDIRECTS = 5;

    for (let salto = 0; ; salto++) {
      try {
        res = await fetch(url, {
          method: "GET",
          headers: { Authorization: `Token ${this.token}`, Accept: "application/json" },
          redirect: "manual",
          cache: "no-store",
        });
      } catch (err) {
        throw new ShoppubApiError(0, "network_error", String((err as Error).message));
      }

      if (![301, 302, 303, 307, 308].includes(res.status)) break;
      const local = res.headers.get("location");
      if (!local || salto >= MAX_REDIRECTS) {
        throw new ShoppubApiError(res.status, "too_many_redirects", "", "Redirecionamento demais ao alcançar a loja.");
      }
      url = new URL(local, url).toString();
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

  /**
   * TODAS as categorias, paginação seguida até o fim — lista pequena (~dezenas
   * a poucas centenas), sem custo de manter offset entre rodadas como o
   * catálogo de produtos precisa.
   */
  async obterCategorias(): Promise<ShoppubCategoria[]> {
    const todas: ShoppubCategoria[] = [];
    for (let page = 1; ; page++) {
      const resposta = await this.request<ShoppubCategoriasPage>("/produto-categorias/", { page });
      todas.push(...resposta.results);
      if (!resposta.next) break;
    }
    return todas;
  }
}
