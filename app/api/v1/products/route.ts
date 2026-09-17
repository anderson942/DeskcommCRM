import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/products — o catálogo da organização ativa.
 * POST /api/v1/products — cadastra um produto.
 *
 * Escrita exige `manager`: preço de venda não se altera com papel de leitura, e
 * é o motivo de este catálogo não morar na tabela da Nuvemshop, cuja policy é
 * org-flat sem checagem de papel.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { agruparProdutos, type GrupoDeProdutos, type ProdutoAgrupavel } from "@/lib/catalogo/agrupamento";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { ordenarPorRelevancia, tokenizar, type ProdutoBuscavel } from "@/lib/catalogo/busca";
import { COLUNAS_DO_PRODUTO, produtoCreateSchema, type Produto } from "@/lib/schemas/produtos";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

/** Tamanhos de página aceitos — "tudo" existe, mas com teto: um catálogo
 * sincronizado (ex.: Tiny) pode ter dezenas de milhares de linhas, e renderizar
 * tudo isso de uma vez trava a aba em vez de ajudar quem só queria ver mais. */
const TAMANHOS_VALIDOS = [10, 25, 50, 100] as const;
const TETO_TUDO = 2000;

/**
 * Quantos candidatos a rede larga do banco traz pro ranqueamento fino do
 * `lib/catalogo/busca.ts` refinar. Grande o bastante pra não perder produto
 * de verdade (a rede é generosa de propósito — ver a migration 0270), pequeno
 * o bastante pra ranquear em memória sem pesar a resposta a cada tecla.
 */
const CANDIDATOS_DA_BUSCA = 500;

type LinhaDeProduto = ProdutoBuscavel & ProdutoAgrupavel & Record<string, unknown>;

/** Uma linha crua devolvida por `fn_listar_produtos_agrupados` (0271) — `variacoes` já vem em JSON. */
interface LinhaAgrupadaDoBanco {
  chave_grupo: string;
  titulo: string;
  ativo_do_grupo: boolean;
  variacoes: Produto[];
  total_grupos: number;
}

function paginaEhTamanho(req: NextRequest): { pagina: number; tamanho: number } {
  const params = req.nextUrl.searchParams;
  const pagina = Math.max(1, Number.parseInt(params.get("pagina") ?? "1", 10) || 1);
  const brutoTamanho = params.get("tamanho");
  if (brutoTamanho === "tudo") return { pagina: 1, tamanho: TETO_TUDO };
  const n = Number.parseInt(brutoTamanho ?? "25", 10);
  const tamanho = (TAMANHOS_VALIDOS as readonly number[]).includes(n) ? n : 25;
  return { pagina, tamanho };
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "catalog_products" });
  if (!authz.ok) return authz.response;

  const busca = req.nextUrl.searchParams.get("busca")?.trim() ?? "";
  // "disponivel" = mais de 1 em estoque; "esgotado" = zerado. Quantidade
  // exatamente 1 não entra em nenhum dos dois de propósito — foi o corte que
  // o Anderson pediu (2026-09-15), não um descuido de "esqueceu do >=".
  const estoqueBruto = req.nextUrl.searchParams.get("estoque");
  const estoque = estoqueBruto === "disponivel" || estoqueBruto === "esgotado" ? estoqueBruto : null;
  const { pagina, tamanho } = paginaEhTamanho(req);
  const supabase = await createClient();

  // Com busca: rede larga no banco (migration 0270 — tolera erro de
  // digitação e ordem trocada de palavra via o índice de trigrama que já
  // existia e nunca tinha sido usado por nada), agrupada em sanfonas de
  // variação (0271) e ranqueada pelo TÍTULO do grupo — pedido do Anderson
  // (2026-09-17): a busca considera só o título da sanfona, nunca o SKU
  // interno, com o MESMO motor que o agente de IA já usa
  // (`lib/catalogo/busca.ts`). Paginação, nesse caminho, acontece DEPOIS do
  // agrupamento e do ranqueamento — a ordem certa só existe depois de
  // pontuar, então `.range()` do banco não serve mais.
  if (busca !== "") {
    const { palavras } = tokenizar(busca);
    const { data, error } = await supabase.rpc("fn_buscar_produtos_candidatos", {
      p_organization_id: authz.org.orgId,
      p_busca: busca,
      p_palavras: palavras,
      p_estoque: estoque,
      p_limite: CANDIDATOS_DA_BUSCA,
    });

    if (error) return fail("internal_error", "Erro ao listar os produtos.", 500, { requestId });

    const grupos = agruparProdutos((data ?? []) as LinhaDeProduto[]);
    // Pseudo-linhas de busca: `nome` é o TÍTULO do grupo, não o nome cru de
    // nenhum SKU — é isso que faz "camiseta 40" (um tamanho) não vazar pro
    // ranqueamento, só a descrição do produto conta.
    const gruposBuscaveis = grupos.map((g) => ({
      nome: g.titulo,
      codigo: g.chave,
      marca: g.variacoes[0]?.marca ?? null,
      categoria: g.variacoes[0]?.categoria ?? null,
      grupo: g,
    }));
    const achados = ordenarPorRelevancia(gruposBuscaveis, busca);
    const gruposRankeados = achados.map((a) => a.produto.grupo);
    const desde = (pagina - 1) * tamanho;
    const pagina_de_grupos = gruposRankeados.slice(desde, desde + tamanho);

    return ok(pagina_de_grupos, {
      requestId,
      meta: { total: gruposRankeados.length, pagina, tamanho },
    });
  }

  // Sem busca: agrupamento + ordenação + paginação inteiros no banco
  // (`fn_listar_produtos_agrupados`, 0271) — evita carregar o catálogo
  // inteiro (~31 mil linhas na Outlet360) em memória a cada troca de página.
  const { data, error } = await supabase.rpc("fn_listar_produtos_agrupados", {
    p_organization_id: authz.org.orgId,
    p_estoque: estoque,
    p_limite: tamanho,
    p_offset: (pagina - 1) * tamanho,
  });

  if (error) return fail("internal_error", "Erro ao listar os produtos.", 500, { requestId });

  const linhas = (data ?? []) as LinhaAgrupadaDoBanco[];
  const grupos: GrupoDeProdutos<Produto>[] = linhas.map((l) => ({
    chave: l.chave_grupo,
    titulo: l.titulo,
    ativo: l.ativo_do_grupo,
    variacoes: l.variacoes,
  }));

  return ok(grupos, { requestId, meta: { total: linhas[0]?.total_grupos ?? 0, pagina, tamanho } });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "catalog_products" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = produtoCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  // A moeda vem da organização, nunca do corpo — ver `moedaDaOrganizacao()`.
  const moeda = await moedaDaOrganizacao(supabase, authz.org.orgId);
  const { data, error } = await supabase
    .from("catalog_products")
    .insert({ ...parsed.data, moeda, organization_id: authz.org.orgId, origem: "manual" })
    .select(COLUNAS_DO_PRODUTO)
    .single();

  if (error) {
    // 23505 = já existe produto com este código nesta organização. A recusa
    // nomeia o campo porque quem lê é quem digitou.
    if (error.code === "23505") {
      return fail("conflict", t("Já existe um produto com esse código."), 409, { requestId });
    }
    return fail("internal_error", "Erro ao salvar o produto.", 500, { requestId });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "catalog_product.created",
    resourceType: "catalog_products",
    resourceId: (data as unknown as { id: string }).id,
    requestId,
  });

  return ok(data, { requestId, status: 201 });
}
