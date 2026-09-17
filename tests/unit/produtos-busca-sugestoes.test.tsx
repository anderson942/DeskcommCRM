import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O dropdown de sugestões da busca inteligente (0270). Reaproveita o MESMO
 * `produtos` que a lista de baixo já buscou e já ranqueou — por isso o mock
 * de `apiClient.get` aqui nunca resolve (igual a
 * `produtos-popup-de-detalhe.test.tsx`): o que abre no dropdown é o
 * `inicial` passado pra `ProdutosClient`, sem depender de round-trip nenhum.
 * O que ESTE arquivo garante é só a fiação da UI — digitar mostra sugestão,
 * clicar abre o popup de detalhe certo e fecha o dropdown. O ranqueamento em
 * si já tem suíte própria em `lib/catalogo/busca.test.ts` e na rota
 * (`app/api/v1/products/route.test.ts`).
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
    codigo: "CAM-TOM-01",
    nome: "Camiseta Tommy Hilfiger Azul",
    descricao: null,
    marca: "Tommy Hilfiger",
    categoria: "Camisetas",
    preco_cents: 24990,
    preco_original_cents: null,
    moeda: "BRL",
    custo_cents: null,
    controla_estoque: true,
    quantidade: 12,
    ativo: true,
    origem: "shoppub",
    imagem_url: null,
    url_produto: "https://www.outlet360.com.br/produto/camiseta-tommy/",
    updated_at: "2026-09-16T00:00:00.000Z",
    ...over,
  };
}

const TEXTOS = { titulo: "Produtos", subtitulo: "", vazio: "", vazioDica: "" };

function montar(itens: Produto[]) {
  render(
    <ProdutosClient inicial={itens} totalInicial={itens.length} tamanhoInicial={25} podeEditar={false} textos={TEXTOS} />,
  );
}

/** Digita e deixa o debounce de 400ms fechar — só depois disso `busca` muda. */
function digitar(texto: string) {
  fireEvent.change(screen.getByTestId("busca-produto"), { target: { value: texto } });
  act(() => vi.advanceTimersByTime(400));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("dropdown de sugestões da busca", () => {
  it("digitar mostra as sugestões, sem esperar o clique em 'ver mais'", () => {
    montar([produto(), produto({ id: "2", codigo: "TENIS-40", nome: "Tênis Nike 40", marca: "Nike" })]);

    digitar("camiseta tom");

    const lista = screen.getByTestId("sugestoes-produto");
    expect(lista).toHaveTextContent("Camiseta Tommy Hilfiger Azul");
    expect(lista).toHaveTextContent("Tênis Nike 40");
  });

  it("clicar numa sugestão abre o popup de detalhe do produto certo e fecha o dropdown", async () => {
    montar([produto(), produto({ id: "2", codigo: "TENIS-40", nome: "Tênis Nike 40", marca: "Nike" })]);

    digitar("nike");
    fireEvent.mouseDown(screen.getByTestId("sugestao-TENIS-40"));
    fireEvent.click(screen.getByTestId("sugestao-TENIS-40"));

    // `findByRole` faz polling com timer real por baixo — troca pra timer
    // real aqui, senão o `waitFor` interno nunca avança (igual ao motivo do
    // `digitar` usar timer falso pro debounce, ao contrário).
    vi.useRealTimers();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Tênis Nike 40");
    expect(dialog).toHaveTextContent("Nike");
    expect(screen.queryByTestId("sugestoes-produto")).not.toBeInTheDocument();
  });

  it("campo vazio não mostra dropdown nenhum", () => {
    montar([produto()]);

    digitar("");

    expect(screen.queryByTestId("sugestoes-produto")).not.toBeInTheDocument();
  });

  it("mostra no máximo 5 sugestões mesmo com mais produtos carregados", () => {
    const muitos = Array.from({ length: 8 }, (_, i) =>
      produto({ id: String(i), codigo: `COD-${i}`, nome: `Camiseta ${i}` }),
    );
    montar(muitos);

    digitar("camiseta");

    const lista = screen.getByTestId("sugestoes-produto");
    expect(lista.querySelectorAll("li")).toHaveLength(5);
  });
});
