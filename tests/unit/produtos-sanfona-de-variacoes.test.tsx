import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * A SANFONA DE VARIAÇÕES (0271).
 *
 * Pedido do Anderson (2026-09-17): produtos que são o MESMO item em
 * tamanhos diferentes (padrão real da Shoppub: "Calça ... 38 - 38", "Calça
 * ... 38 40 - 40", "Calça ... 38 40 42 - 42"…) apareciam como uma linha por
 * SKU. Agora aparecem como UMA linha com o título limpo, que expande pra
 * mostrar cada variação com seu preço — clicando numa variação abre o MESMO
 * popup de detalhe que uma linha solta (produto sem irmão de tamanho) já
 * abre.
 *
 * O agrupamento em si (chave, título, ordem) já tem suíte própria em
 * `lib/catalogo/agrupamento.test.ts` — este arquivo cobre só a UI: fechada
 * por padrão, expande ao clicar, cada variação com preço e abrindo o
 * detalhe certo, produto sem irmão continua uma linha solta sem acordeão.
 */

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(), patch: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/hooks/auth/AuthProvider", () => ({ usePermission: () => true }));

import { ProdutosClient } from "@/app/app/products/_client";
import type { Produto } from "@/lib/schemas/produtos";

function produto(over: Partial<Produto> = {}): Produto {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    codigo: "VOLD000000425-38",
    nome: "Calça VersatiOld Alfaiataria Premium Slim Cinza 38 - 38",
    descricao: null,
    marca: null,
    categoria: null,
    preco_cents: 20700,
    preco_original_cents: 24900,
    moeda: "BRL",
    custo_cents: null,
    controla_estoque: true,
    quantidade: 9,
    ativo: true,
    origem: "shoppub",
    imagem_url: null,
    url_produto: null,
    updated_at: "2026-09-17T00:00:00.000Z",
    ...over,
  };
}

/** As 3 primeiras variações reais do print do Anderson. */
function variacoesDaCalca(): Produto[] {
  return [
    produto({ id: "1", codigo: "VOLD000000425-38", nome: "Calça VersatiOld Alfaiataria Premium Slim Cinza 38 - 38", quantidade: 9 }),
    produto({ id: "2", codigo: "VOLD000000425-40", nome: "Calça VersatiOld Alfaiataria Premium Slim Cinza 38 40 - 40", quantidade: 37 }),
    produto({ id: "3", codigo: "VOLD000000425-42", nome: "Calça VersatiOld Alfaiataria Premium Slim Cinza 38 40 42 - 42", quantidade: 26 }),
  ];
}

const TEXTOS = { titulo: "Produtos", subtitulo: "", vazio: "", vazioDica: "" };

function montar(itens: Produto[], podeEditar = false) {
  render(
    <ProdutosClient
      inicial={itens}
      totalInicial={itens.length}
      tamanhoInicial={25}
      podeEditar={podeEditar}
      textos={TEXTOS}
    />,
  );
}

describe("sanfona de variações na lista de produtos", () => {
  it("fechada por padrão: mostra só o título limpo, sem os SKUs individuais", () => {
    montar(variacoesDaCalca());

    expect(screen.getByTestId("abrir-grupo-VOLD000000425")).toHaveTextContent(
      "Calça VersatiOld Alfaiataria Premium Slim Cinza",
    );
    // O título fechado não pode conter a cauda de tamanho de nenhum SKU.
    expect(screen.getByTestId("abrir-grupo-VOLD000000425")).not.toHaveTextContent("38 - 38");
    expect(screen.queryByTestId("variacoes-VOLD000000425")).not.toBeInTheDocument();
  });

  it("clicar expande: cada variação aparece como 'título - tamanho', com seu próprio preço", () => {
    montar(variacoesDaCalca());

    fireEvent.click(screen.getByTestId("abrir-grupo-VOLD000000425"));

    const variacoes = screen.getByTestId("variacoes-VOLD000000425");
    expect(variacoes).toHaveTextContent("Calça VersatiOld Alfaiataria Premium Slim Cinza - 38");
    expect(variacoes).toHaveTextContent("Calça VersatiOld Alfaiataria Premium Slim Cinza - 40");
    expect(variacoes).toHaveTextContent("Calça VersatiOld Alfaiataria Premium Slim Cinza - 42");
    // Preço "de/por" por variação, igual a uma linha solta.
    expect(screen.getByTestId("preco-por-VOLD000000425-38")).toHaveTextContent("R$ 207,00");
    expect(screen.getByTestId("preco-de-VOLD000000425-38")).toHaveTextContent("R$ 249,00");
  });

  it("clicar de novo recolhe a sanfona", () => {
    montar(variacoesDaCalca());

    const abrir = screen.getByTestId("abrir-grupo-VOLD000000425");
    fireEvent.click(abrir);
    expect(screen.getByTestId("variacoes-VOLD000000425")).toBeInTheDocument();

    fireEvent.click(abrir);
    expect(screen.queryByTestId("variacoes-VOLD000000425")).not.toBeInTheDocument();
  });

  it("clicar numa variação aberta abre o MESMO popup de detalhe que uma linha solta abre", async () => {
    montar(variacoesDaCalca());

    fireEvent.click(screen.getByTestId("abrir-grupo-VOLD000000425"));
    fireEvent.click(screen.getByTestId("abrir-detalhe-VOLD000000425-40"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("37 em estoque");
  });

  it("produto sem irmão de tamanho continua uma linha solta, sem chrome de acordeão", () => {
    montar([produto({ id: "1", codigo: "BONE-RL-01", nome: "Boné Polo RL Classic Chumbo" })]);

    expect(screen.getByTestId("produto-BONE-RL-01")).toBeInTheDocument();
    expect(screen.queryByTestId(/^abrir-grupo-/)).not.toBeInTheDocument();
  });

  it("com permissão de editar, desativar/reativar continua por VARIAÇÃO dentro da sanfona aberta", () => {
    montar(variacoesDaCalca(), true);

    fireEvent.click(screen.getByTestId("abrir-grupo-VOLD000000425"));

    expect(screen.getByTestId("alternar-VOLD000000425-38")).toHaveTextContent("Desativar");
    expect(screen.getByTestId("alternar-VOLD000000425-40")).toHaveTextContent("Desativar");
  });
});
