import { describe, expect, it } from "vitest";

import { imagemPrincipal, mapearProduto } from "@/lib/shoppub/mapear-produto";
import type { ShoppubImagemDeProduto, ShoppubProduto } from "@/lib/shoppub/api-client";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const HOST = "www.outlet360.com.br";
const MAPA_VAZIO = new Map<number, string>();

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
    const linha = mapearProduto(produto({ preco_por: 103.0 }), ORG_ID, HOST, MAPA_VAZIO);
    expect(linha.preco_cents).toBe(10300);
  });

  it("preco_original_cents fica null quando não há promoção (de === por)", () => {
    const linha = mapearProduto(produto({ preco_de: 110.0, preco_por: 110.0 }), ORG_ID, HOST, MAPA_VAZIO);
    expect(linha.preco_original_cents).toBeNull();
  });

  it("preco_original_cents vem o 'de' quando há promoção de verdade", () => {
    const linha = mapearProduto(produto({ preco_de: 110.0, preco_por: 103.0 }), ORG_ID, HOST, MAPA_VAZIO);
    expect(linha.preco_original_cents).toBe(11000);
  });

  it("quantidade é o disponível pra VENDER — total menos reservado, não o bruto", () => {
    // Documentado no webhook de produto da Shoppub: "estoque: Total stock =
    // Stock + Reserve Stock" — o que sobra pra vender desconta o reservado.
    const linha = mapearProduto(produto({ estoque: 1000, estoque_reserva: 10 }), ORG_ID, HOST, MAPA_VAZIO);
    expect(linha.quantidade).toBe(990);
  });

  it("quantidade nunca fica negativa mesmo se reserva > estoque", () => {
    const linha = mapearProduto(produto({ estoque: 5, estoque_reserva: 8 }), ORG_ID, HOST, MAPA_VAZIO);
    expect(linha.quantidade).toBe(0);
  });

  it("custo_cents é null quando a Shoppub não informa preço de custo", () => {
    const linha = mapearProduto(produto({ preco_custo: 0 }), ORG_ID, HOST, MAPA_VAZIO);
    expect(linha.custo_cents).toBeNull();
  });

  it("origem sempre 'shoppub', código é o sku, ativo espelha o campo da Shoppub", () => {
    const linha = mapearProduto(produto({ sku: "TENIS-40", ativo: false }), ORG_ID, HOST, MAPA_VAZIO);
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
    const linha = mapearProduto(produto({ slug: "bone-rl-classic-chumbo" }), ORG_ID, HOST, MAPA_VAZIO);
    expect(linha.url_produto).toBe("https://www.outlet360.com.br/produto/bone-rl-classic-chumbo/");
  });

  it("url_produto fica null quando a Shoppub não manda slug", () => {
    const linha = mapearProduto(produto({ slug: "" }), ORG_ID, HOST, MAPA_VAZIO);
    expect(linha.url_produto).toBeNull();
  });

  /**
   * `fabricante_info` já vem EMBUTIDO na listagem de produtos — medido
   * direto na loja real (2026-09-16): `{"fabricante":147,"fabricante_info":
   * {"id":147,"nome":"Aramis",...}}`. Sem chamada extra nenhuma, diferente
   * de categoria.
   */
  it("marca vem de fabricante_info — sem precisar de mapa nenhum", () => {
    const linha = mapearProduto(
      produto({ fabricante: 147, fabricante_info: { id: 147, nome: "Aramis" } }),
      ORG_ID,
      HOST,
      MAPA_VAZIO,
    );
    expect(linha.marca).toBe("Aramis");
  });

  it("marca fica null quando a Shoppub não manda fabricante_info", () => {
    const linha = mapearProduto(produto({ fabricante: null, fabricante_info: null }), ORG_ID, HOST, MAPA_VAZIO);
    expect(linha.marca).toBeNull();
  });

  describe("categoria — resolvida via mapa, não vem com nome pronto", () => {
    it("junta os nomes resolvidos com ', ' — categorias é só uma lista de IDs", () => {
      const mapa = new Map([
        [410, "Roupas"],
        [414, "Camisetas"],
      ]);
      const linha = mapearProduto(produto({ categorias: [410, 414] }), ORG_ID, HOST, mapa);
      expect(linha.categoria).toBe("Roupas, Camisetas");
    });

    it("ID sem correspondência no mapa é OMITIDO, não vira número cru na tela", () => {
      const mapa = new Map([[410, "Roupas"]]);
      const linha = mapearProduto(produto({ categorias: [410, 999999] }), ORG_ID, HOST, mapa);
      expect(linha.categoria).toBe("Roupas");
    });

    it("fica null quando o produto não tem categoria nenhuma, ou nenhuma resolveu", () => {
      expect(mapearProduto(produto({ categorias: [] }), ORG_ID, HOST, MAPA_VAZIO).categoria).toBeNull();
      expect(mapearProduto(produto({ categorias: [999999] }), ORG_ID, HOST, MAPA_VAZIO).categoria).toBeNull();
    });
  });
});

/**
 * `imagemPrincipal` (0274) — qual das imagens da Shoppub vira `imagem_url`.
 * A API não tem campo de imagem na listagem/detalhe de produto; imagem vem
 * de um endpoint à parte (`GET /produto-imagens/{sku}/`), que devolve uma
 * lista — este é o critério de "qual delas é A foto que a sanfona mostra".
 */
describe("imagemPrincipal", () => {
  function imagem(over: Partial<ShoppubImagemDeProduto> = {}): ShoppubImagemDeProduto {
    return { id: 1, foto: "https://cdn.exemplo/foto.jpg", principal: false, order: 0, ...over };
  }

  it("lista vazia — produto sem foto cadastrada — devolve null", () => {
    expect(imagemPrincipal([])).toBeNull();
  });

  it("usa a marcada `principal`, mesmo que não seja a de menor `order`", () => {
    const imagens = [
      imagem({ id: 1, foto: "capa.jpg", principal: false, order: 0 }),
      imagem({ id: 2, foto: "a-de-verdade.jpg", principal: true, order: 2 }),
    ];
    expect(imagemPrincipal(imagens)).toBe("a-de-verdade.jpg");
  });

  it("sem nenhuma marcada `principal`, usa a de menor `order`", () => {
    const imagens = [
      imagem({ id: 1, foto: "segunda.jpg", principal: false, order: 1 }),
      imagem({ id: 2, foto: "primeira.jpg", principal: false, order: 0 }),
    ];
    expect(imagemPrincipal(imagens)).toBe("primeira.jpg");
  });

  it("uma imagem só, sem `principal` marcado — usa ela mesma", () => {
    expect(imagemPrincipal([imagem({ foto: "unica.jpg" })])).toBe("unica.jpg");
  });
});
