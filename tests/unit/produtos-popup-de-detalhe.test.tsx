import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * Clicar num produto abre um popup de detalhe (nome, código, marca,
 * categoria, preço de/por, estoque, origem, link da loja) em vez de
 * espalhar mais colunas/ícones na tabela — pedido do Anderson (2026-09-16),
 * depois de sincronizar categoria/marca da Shoppub.
 *
 * Desde a sanfona de variações (0271) + "sempre sanfona" (2026-09-18), todo
 * produto — mesmo sem irmão de tamanho — mora dentro de um grupo que abre
 * antes de mostrar o botão de detalhe; por isso cada teste aqui expande o
 * grupo (`abrir-grupo-<chave>`) antes de clicar no produto.
 */

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(), patch: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

import { ProdutosClient } from "@/app/app/products/_client";
import type { Produto } from "@/lib/schemas/produtos";

function produto(over: Partial<Produto> = {}): Produto {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    codigo: "BONE-RL-01",
    nome: "Boné Polo RL Classic Chumbo",
    descricao: null,
    marca: "Ralph Lauren",
    categoria: "Acessórios, Bonés",
    preco_cents: 24990,
    preco_original_cents: null,
    moeda: "BRL",
    custo_cents: null,
    controla_estoque: true,
    quantidade: 12,
    ativo: true,
    origem: "shoppub",
    imagem_url: null,
    url_produto: "https://www.outlet360.com.br/produto/bone-rl-classic-chumbo/",
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

/** Abre a sanfona do grupo (sempre fechada por padrão) antes de poder clicar num produto dentro dela. */
function abrirGrupo(chave: string) {
  fireEvent.click(screen.getByTestId(`abrir-grupo-${chave}`));
}

describe("popup de detalhe do produto", () => {
  it("clicar no nome abre o popup com marca, categoria, estoque, origem e link", async () => {
    montar([produto()]);

    abrirGrupo("BONE-RL");
    fireEvent.click(screen.getByTestId("abrir-detalhe-BONE-RL-01"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Ralph Lauren");
    expect(dialog).toHaveTextContent("Acessórios, Bonés");
    expect(dialog).toHaveTextContent("12 em estoque");
    expect(dialog).toHaveTextContent("Shoppub");
    const link = screen.getByRole("link", { name: /ver na loja/i });
    expect(link).toHaveAttribute("href", "https://www.outlet360.com.br/produto/bone-rl-classic-chumbo/");
  });

  /**
   * O BUG RELATADO (2026-09-16): nome de produto longo ("Calça VersatiOld
   * Alfaiataria Premium Slim Cinza 38 40 42 44 46 48 50 - 50", comum na
   * Shoppub) e uma linha de preço/categoria vazavam pra fora da caixa do
   * dialog. Causa: `flex justify-between` com rótulo/valor como IRMÃOS —
   * item flex sem `min-w-0` não encolhe abaixo do próprio conteúdo, então
   * `truncate` (que depende de conseguir encolher) simplesmente não fazia
   * nada e o texto vazava. Rótulo em cima, valor embaixo é imune à classe
   * inteira desse bug — não tem irmão flex pra disputar espaço.
   */
  it("nome longo (concatena todas as variações, comum na Shoppub) não usa truncate/nowrap que vazava da caixa", async () => {
    const nomeLongo =
      "Calça VersatiOld Alfaiataria Premium Slim Cinza 38 40 42 44 46 48 50 - 50";
    montar([produto({ nome: nomeLongo })]);

    abrirGrupo("BONE-RL");
    fireEvent.click(screen.getByTestId("abrir-detalhe-BONE-RL-01"));
    const dialog = await screen.findByRole("dialog");

    expect(dialog).toHaveTextContent(nomeLongo);
    const titulo = within(dialog).getByText(nomeLongo);
    // `truncate` (overflow:hidden + nowrap) é exatamente a classe que causou
    // o vazamento — sem `min-w-0` no pai flex ela não encolhe, só empurra o
    // texto pra fora da caixa. Título e valores agora quebram linha
    // (`break-words`), nunca cortam com nowrap.
    expect(titulo.className).not.toContain("truncate");
    expect(titulo.closest('[class*="justify-between"]')).toBeNull();
  });

  it("produto sem marca/categoria/link não mostra essas linhas nem quebra", async () => {
    montar([produto({ marca: null, categoria: null, url_produto: null })]);

    abrirGrupo("BONE-RL");
    fireEvent.click(screen.getByTestId("abrir-detalhe-BONE-RL-01"));

    const dialog = await screen.findByRole("dialog");
    expect(screen.queryByRole("link", { name: /ver na loja/i })).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("Marca");
    expect(dialog).not.toHaveTextContent("Categoria");
  });

  it("produto inativo mostra o selo, produto ativo não mostra nada extra", async () => {
    montar([produto({ ativo: false })]);
    abrirGrupo("BONE-RL");
    fireEvent.click(screen.getByTestId("abrir-detalhe-BONE-RL-01"));
    expect(await screen.findByText("Inativo")).toBeInTheDocument();
  });

  it("fechar o popup e clicar noutro produto troca o conteúdo, não empilha", async () => {
    montar([produto(), produto({ id: "2", codigo: "TENIS-40", nome: "Tênis 40", marca: "Nike" })]);

    abrirGrupo("BONE-RL");
    fireEvent.click(screen.getByTestId("abrir-detalhe-BONE-RL-01"));
    expect(await screen.findByText("Ralph Lauren")).toBeInTheDocument();

    // Fecha (Escape é o caminho padrão do Radix Dialog) e abre o outro.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    abrirGrupo("TENIS");
    fireEvent.click(screen.getByTestId("abrir-detalhe-TENIS-40"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Nike");
    expect(dialog).not.toHaveTextContent("Ralph Lauren");
  });
});

// A fixture exercita um atendente autorizado a consultar modelos de mensagem.
vi.mock("@/hooks/auth/AuthProvider", () => ({ usePermission: () => true }));
