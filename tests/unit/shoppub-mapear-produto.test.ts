import { describe, expect, it } from "vitest";

import { mapearProduto } from "@/lib/shoppub/mapear-produto";
import type { ShoppubProduto } from "@/lib/shoppub/api-client";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const HOST = "www.outlet360.com.br";

function produto(over: Partial<ShoppubProduto> = {}): ShoppubProduto {
  return {
    id: 2621,
    sku: "IP15",
    nome: "iPhone 15",
    slug: "iphone-15",
    ativo: true,
    preco_de: 110.0,
    preco_por: 110.0,
    preco_custo: 90.0,
    estoque: 100,
    estoque_reserva: 0,
    ...over,
  };
}

describe("mapearProduto", () => {
  it("usa preco_por como o preço EFETIVO — o que a IA responde/cobra", () => {
    const linha = mapearProduto(produto({ preco_por: 103.0 }), ORG_ID, HOST);
    expect(linha.preco_cents).toBe(10300);
  });

  it("preco_original_cents fica null quando não há promoção (de === por)", () => {
    const linha = mapearProduto(produto({ preco_de: 110.0, preco_por: 110.0 }), ORG_ID, HOST);
    expect(linha.preco_original_cents).toBeNull();
  });

  it("preco_original_cents vem o 'de' quando há promoção de verdade", () => {
    const linha = mapearProduto(produto({ preco_de: 110.0, preco_por: 103.0 }), ORG_ID, HOST);
    expect(linha.preco_original_cents).toBe(11000);
  });

  it("quantidade é o disponível pra VENDER — total menos reservado, não o bruto", () => {
    // Documentado no webhook de produto da Shoppub: "estoque: Total stock =
    // Stock + Reserve Stock" — o que sobra pra vender desconta o reservado.
    const linha = mapearProduto(produto({ estoque: 1000, estoque_reserva: 10 }), ORG_ID, HOST);
    expect(linha.quantidade).toBe(990);
  });

  it("quantidade nunca fica negativa mesmo se reserva > estoque", () => {
    const linha = mapearProduto(produto({ estoque: 5, estoque_reserva: 8 }), ORG_ID, HOST);
    expect(linha.quantidade).toBe(0);
  });

  it("custo_cents é null quando a Shoppub não informa preço de custo", () => {
    const linha = mapearProduto(produto({ preco_custo: 0 }), ORG_ID, HOST);
    expect(linha.custo_cents).toBeNull();
  });

  it("origem sempre 'shoppub', código é o sku, ativo espelha o campo da Shoppub", () => {
    const linha = mapearProduto(produto({ sku: "TENIS-40", ativo: false }), ORG_ID, HOST);
    expect(linha.origem).toBe("shoppub");
    expect(linha.codigo).toBe("TENIS-40");
    expect(linha.ativo).toBe(false);
    expect(linha.organization_id).toBe(ORG_ID);
  });

  /**
   * Padrão CONFIRMADO contra a loja real (2026-09-16), não adivinhado:
   * `GET https://www.outlet360.com.br/produto/bone-rl-classic-chumbo/` → 200
   * num produto ativo de verdade.
   */
  it("url_produto usa o padrão real da loja: https://{host}/produto/{slug}/", () => {
    const linha = mapearProduto(produto({ slug: "bone-rl-classic-chumbo" }), ORG_ID, HOST);
    expect(linha.url_produto).toBe("https://www.outlet360.com.br/produto/bone-rl-classic-chumbo/");
  });

  it("url_produto fica null quando a Shoppub não manda slug", () => {
    const linha = mapearProduto(produto({ slug: "" }), ORG_ID, HOST);
    expect(linha.url_produto).toBeNull();
  });
});
