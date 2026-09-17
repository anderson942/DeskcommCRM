import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

/** O que a rota mandou para o `insert` — é sobre isto que as asserções falam. */
let inserido: Record<string, unknown> | null = null;
/** O org id que o `.eq()` de `organizations` recebeu — o alvo do hallazgo 4. */
let orgIdLido: string | null = null;

/**
 * Supabase de mentira com as DUAS tabelas que a rota toca: lê a moeda em
 * `organizations` e grava em `catalog_products`.
 */
function supabaseCom(moedaDaOrg: string | null) {
  return {
    from: (tabela: string) => {
      if (tabela === "organizations") {
        return {
          select: () => ({
            eq: (_coluna: string, valor: string) => {
              orgIdLido = valor;
              return {
                maybeSingle: async () => ({
                  data: moedaDaOrg === null ? null : { currency: moedaDaOrg },
                  error: null,
                }),
              };
            },
          }),
        };
      }
      return {
        insert: (linha: Record<string, unknown>) => {
          inserido = linha;
          return {
            select: () => ({
              single: async () => ({ data: { id: "p1", ...linha }, error: null }),
            }),
          };
        },
      };
    },
  };
}

function pedido(corpo: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/products", {
    method: "POST",
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  });
}

const PRODUTO = { codigo: "IP15", nome: "iPhone 15", preco_cents: 549900 };

beforeEach(() => {
  vi.clearAllMocks();
  inserido = null;
  orgIdLido = null;
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER_ID },
    org: { orgId: ORG_ID },
  } as never);
});

describe("POST /api/v1/products — a moeda vem da organização", () => {
  /**
   * ⚠️ SABOTAGEM. A moeda do corpo não decide, pela mesma razão que o
   * `organization_id` do corpo não decide (CLAUDE.md, multi-tenancy): quem
   * escolhe unidade e escopo é a fonte confiável, nunca o cliente. Sem esta
   * guarda, uma chamada direta à API grava um produto em USD num catálogo que
   * a organização declarou em BRL — e o agente cota esse número ao cliente.
   */
  it("ignora a moeda que vem no corpo", async () => {
    vi.mocked(createClient).mockResolvedValue(supabaseCom("BRL") as never);
    const { POST } = await import("./route");

    const resposta = await POST(pedido({ ...PRODUTO, moeda: "USD" }));

    expect(resposta.status).toBe(201);
    expect(inserido).toMatchObject({ moeda: "BRL" });
    // O scope também vem de fonte confiável, nunca do body — o mock não pode
    // só provar "moeda ignorada" enquanto deixa passar um `organization_id`
    // vazado, que é a MESMA classe de bug (CLAUDE.md, multi-tenancy).
    expect(orgIdLido).toBe(ORG_ID);
  });

  /**
   * ⚠️ TESTE DISCRIMINANTE. O caso acima sozinho passa VERDE com a moeda
   * chumbada em 'BRL' — que é exatamente o defeito que este PR conserta. Só a
   * organização em MXN prova que a rota foi LER a coluna.
   */
  it("grava a moeda que a organização declarou, não o padrão", async () => {
    vi.mocked(createClient).mockResolvedValue(supabaseCom("MXN") as never);
    const { POST } = await import("./route");

    const resposta = await POST(pedido({ ...PRODUTO, moeda: "USD" }));

    expect(resposta.status).toBe(201);
    expect(inserido).toMatchObject({ moeda: "MXN" });
    expect(orgIdLido).toBe(ORG_ID);
  });

  /**
   * A leitura da organização pode falhar (linha some, RLS nega). `moedaDaOrganizacao()`
   * escreve `MOEDA_PADRAO` ('BRL') EXPLÍCITO no insert — não é o `default` da
   * coluna que decide, porque a rota manda um valor no corpo do insert de
   * qualquer forma. O nome deste teste dizia o contrário antes da revisão: o
   * `default` da coluna nunca chega a ser exercitado por este caminho.
   */
  it("cai na moeda padrão quando a organização não responde, escrita explícita", async () => {
    vi.mocked(createClient).mockResolvedValue(supabaseCom(null) as never);
    const { POST } = await import("./route");

    const resposta = await POST(pedido({ ...PRODUTO, moeda: "USD" }));

    expect(resposta.status).toBe(201);
    expect(inserido).toMatchObject({ moeda: "BRL" });
    expect(orgIdLido).toBe(ORG_ID);
  });
});

// Este teste isola o handler; autoridade de suporte é exercitada na suíte própria.
vi.mock("@/lib/impersonate/support", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/impersonate/support")>(),
  requireSupportWrite: vi.fn(async () => null),
  authenticatedSessionId: vi.fn(async () => "f2200000-0000-4000-8000-000000000099"),
}));

/**
 * GET /api/v1/products?busca=… — a busca inteligente (0270).
 *
 * ⚠️ O QUE ESTE ARQUIVO GUARDA, E O QUE ELE NÃO GUARDA. O ranqueamento em si
 * (palavra aproximada, número exato) já tem suíte própria em
 * `lib/catalogo/busca.test.ts` — não repetido aqui. O que é específico DESTA
 * rota, e por isso mora aqui: ela CHAMA a rede larga do banco com os
 * parâmetros certos (organização de fonte confiável, não do query string),
 * ela RANQUEIA o que a rede devolveu em vez de confiar na ordem do banco, e
 * ela PAGINA depois de ranquear — os três jeitos de esta integração quebrar
 * sem que o teste do motor de busca visse nada.
 */
function requisicaoDeBusca(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/products?${query}`);
}

function supabaseParaBusca(candidatos: Array<Record<string, unknown>>) {
  const chamada: { nome: string | null; params: Record<string, unknown> | null } = {
    nome: null,
    params: null,
  };
  return {
    supabase: {
      rpc: (nome: string, params: Record<string, unknown>) => {
        chamada.nome = nome;
        chamada.params = params;
        return Promise.resolve({ data: candidatos, error: null });
      },
    },
    chamada,
  };
}

describe("GET /api/v1/products?busca= — rede larga + ranqueamento fino", () => {
  it("chama a rede larga com a organização de fonte confiável, não do query string", async () => {
    const { supabase, chamada } = supabaseParaBusca([]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    const { GET } = await import("./route");

    await GET(requisicaoDeBusca(`busca=camiseta&organization_id=${"33333333-3333-4333-8333-333333333333"}`));

    expect(chamada.nome).toBe("fn_buscar_produtos_candidatos");
    // O `organization_id` do query string (um valor de outra org, no teste) tem
    // de ser IGNORADO — é a mesma classe de guarda que o POST já prova acima.
    expect((chamada.params as { p_organization_id: string }).p_organization_id).toBe(ORG_ID);
  });

  it("ranqueia os candidatos — a ordem do banco não é a resposta final", async () => {
    // "Camisa" empata por substring com "camiseta" nas duas, mas só a segunda
    // é prefixo de verdade da palavra buscada — o banco não sabe disso, quem
    // sabe é `lib/catalogo/busca.ts`. Candidatos vêm do banco FORA de ordem
    // de propósito, pra provar que é a rota (via `ordenarPorRelevancia`) quem
    // reordena, não o banco.
    const { supabase } = supabaseParaBusca([
      { id: "1", codigo: "A", nome: "Blusa qualquer", marca: null, categoria: null },
      { id: "2", codigo: "B", nome: "Camiseta Azul", marca: null, categoria: null },
    ]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    const { GET } = await import("./route");

    const resposta = await GET(requisicaoDeBusca("busca=camiseta"));
    const corpo = (await resposta.json()) as { data: Array<{ codigo: string }> };

    expect(corpo.data.map((p) => p.codigo)).toEqual(["B"]);
  });

  it("pagina DEPOIS de ranquear — página 2 não é um corte cru do banco", async () => {
    const candidatos = Array.from({ length: 15 }, (_, i) => ({
      id: String(i),
      codigo: `C${i}`,
      nome: `Camiseta ${i}`,
      marca: null,
      categoria: null,
    }));
    const { supabase } = supabaseParaBusca(candidatos);
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    const { GET } = await import("./route");

    const resposta = await GET(requisicaoDeBusca("busca=camiseta&pagina=2&tamanho=10"));
    const corpo = (await resposta.json()) as {
      data: Array<{ codigo: string }>;
      meta: { total: number };
    };

    expect(corpo.data).toHaveLength(5);
    expect(corpo.meta.total).toBe(15);
  });
});
