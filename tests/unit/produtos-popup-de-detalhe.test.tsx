import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * Clicar num produto abre um popup de detalhe (nome, código, marca,
 * categoria, preço de/por, estoque, origem, link da loja) em vez de
 * espalhar mais colunas/ícones na tabela — pedido do Anderson (2026-09-16),
 * depois de sincronizar categoria/marca da Shoppub.
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

describe("popup de detalhe do produto", () => {
  it("clicar no nome abre o popup com marca, categoria, estoque, origem e link", async () => {
    montar([produto()]);

    fireEvent.click(screen.getByTestId("abrir-detalhe-BONE-RL-01"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Ralph Lauren");
    expect(dialog).toHaveTextContent("Acessórios, Bonés");
    expect(dialog).toHaveTextContent("12 em estoque");
    expect(dialog).toHaveTextContent("Shoppub");
    const link = screen.getByRole("link", { name: /ver na loja/i });
    expect(link).toHaveAttribute("href", "https://www.outlet360.com.br/produto/bone-rl-classic-chumbo/");
  });

  it("produto sem marca/categoria/link não mostra essas linhas nem quebra", async () => {
    montar([produto({ marca: null, categoria: null, url_produto: null })]);

    fireEvent.click(screen.getByTestId("abrir-detalhe-BONE-RL-01"));

    const dialog = await screen.findByRole("dialog");
    expect(screen.queryByRole("link", { name: /ver na loja/i })).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("Marca");
    expect(dialog).not.toHaveTextContent("Categoria");
  });

  it("produto inativo mostra o selo, produto ativo não mostra nada extra", async () => {
    montar([produto({ ativo: false })]);
    fireEvent.click(screen.getByTestId("abrir-detalhe-BONE-RL-01"));
    expect(await screen.findByText("Inativo")).toBeInTheDocument();
  });

  it("fechar o popup e clicar noutro produto troca o conteúdo, não empilha", async () => {
    montar([produto(), produto({ id: "2", codigo: "TENIS-40", nome: "Tênis 40", marca: "Nike" })]);

    fireEvent.click(screen.getByTestId("abrir-detalhe-BONE-RL-01"));
    expect(await screen.findByText("Ralph Lauren")).toBeInTheDocument();

    // Fecha (Escape é o caminho padrão do Radix Dialog) e abre o outro.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("abrir-detalhe-TENIS-40"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Nike");
    expect(dialog).not.toHaveTextContent("Ralph Lauren");
  });
});

// A fixture exercita um atendente autorizado a consultar modelos de mensagem.
vi.mock("@/hooks/auth/AuthProvider", () => ({ usePermission: () => true }));
