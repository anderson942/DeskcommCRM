import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O dropdown de sugestões da busca inteligente (0270), agora agrupado em
 * sanfonas de variação (0271) — cada sugestão é um TÍTULO de grupo, não um
 * SKU. Reaproveita o MESMO `grupos` que a lista de baixo já buscou/agrupou/
 * ranqueou; por isso o mock de `apiClient.get` aqui nunca resolve (igual a
 * `produtos-popup-de-detalhe.test.tsx`): o que abre no dropdown vem do
 * `inicial` passado pra `ProdutosClient` (agrupado no cliente uma vez), sem
 * depender de round-trip nenhum. O que ESTE arquivo garante é só a fiação da
 * UI — digitar mostra sugestão, clicar num grupo de 1 abre o popup de
 * detalhe, clicar num grupo de N abre a sanfona. O ranqueamento e o
 * agrupamento em si já têm suíte própria em `lib/catalogo/busca.test.ts`,
 * `lib/catalogo/agrupamento.test.ts` e na rota (`route.test.ts`).
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
  it("digitar mostra as sugestões (título do grupo), sem esperar o clique em 'ver mais'", () => {
    montar([produto(), produto({ id: "2", codigo: "TENIS-40", nome: "Tênis Nike 40", marca: "Nike" })]);

    digitar("camiseta tom");

    const lista = screen.getByTestId("sugestoes-produto");
    expect(lista).toHaveTextContent("Camiseta Tommy Hilfiger Azul");
    expect(lista).toHaveTextContent("Tênis Nike 40");
  });

  it("grupo de 1: clicar na sugestão abre o popup de detalhe direto e fecha o dropdown", async () => {
    montar([produto(), produto({ id: "2", codigo: "TENIS-40", nome: "Tênis Nike 40", marca: "Nike" })]);

    digitar("nike");
    // Chave do grupo é o código sem o sufixo de tamanho: "TENIS-40" -> "TENIS".
    fireEvent.mouseDown(screen.getByTestId("sugestao-TENIS"));
    fireEvent.click(screen.getByTestId("sugestao-TENIS"));

    // `findByRole` faz polling com timer real por baixo — troca pra timer
    // real aqui, senão o `waitFor` interno nunca avança (igual ao motivo do
    // `digitar` usar timer falso pro debounce, ao contrário).
    vi.useRealTimers();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Tênis Nike 40");
    expect(dialog).toHaveTextContent("Nike");
    expect(screen.queryByTestId("sugestoes-produto")).not.toBeInTheDocument();
  });

  it("grupo de N: clicar na sugestão abre a sanfona em vez do popup — não existe 'o' produto", () => {
    montar([
      produto({ id: "1", codigo: "VOLD-38", nome: "Calça Cinza 38 - 38" }),
      produto({ id: "2", codigo: "VOLD-40", nome: "Calça Cinza 38 40 - 40" }),
    ]);

    digitar("calca");
    fireEvent.mouseDown(screen.getByTestId("sugestao-VOLD"));
    fireEvent.click(screen.getByTestId("sugestao-VOLD"));

    expect(screen.queryByTestId("sugestoes-produto")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("variacoes-VOLD")).toHaveTextContent("Calça Cinza - 38");
    expect(screen.getByTestId("variacoes-VOLD")).toHaveTextContent("Calça Cinza - 40");
  });

  it("campo vazio não mostra dropdown nenhum", () => {
    montar([produto()]);

    digitar("");

    expect(screen.queryByTestId("sugestoes-produto")).not.toBeInTheDocument();
  });

  it("mostra no máximo 5 sugestões mesmo com mais grupos carregados", () => {
    // Códigos sem sufixo "-NN": cada um é o próprio grupo, sem colidir entre si.
    const muitos = Array.from({ length: 8 }, (_, i) =>
      produto({ id: String(i), codigo: `CAMISETA${i}`, nome: `Camiseta ${i}` }),
    );
    montar(muitos);

    digitar("camiseta");

    const lista = screen.getByTestId("sugestoes-produto");
    expect(lista.querySelectorAll("li")).toHaveLength(5);
  });
});
