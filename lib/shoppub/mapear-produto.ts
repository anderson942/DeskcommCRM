/**
 * Um produto da Shoppub → a linha que `catalog_products` espera.
 *
 * Compartilhado entre o webhook (`app/api/v1/webhooks/shoppub/[token]`) e o
 * backfill (`app/api/v1/cron/shoppub-backfill`) — mesma regra nos dois
 * lugares, não duas cópias que podem divergir.
 */
import type { ShoppubProduto } from "./api-client";

/**
 * O "de" — só quando existe promoção de verdade (por < de). `null` no caso
 * comum evita `preco_original_cents` virar um "de X por X" sem desconto
 * nenhum, que é ruído na tela, não informação. Mesma regra da Tiny.
 */
function precoOriginalCents(p: ShoppubProduto): number | null {
  const de = Math.round(p.preco_de * 100);
  const por = Math.round(p.preco_por * 100);
  return por < de ? de : null;
}

export function mapearProduto(p: ShoppubProduto, orgId: string) {
  return {
    organization_id: orgId,
    codigo: p.sku,
    nome: p.nome,
    marca: null,
    categoria: null,
    preco_cents: Math.round(p.preco_por * 100),
    preco_original_cents: precoOriginalCents(p),
    custo_cents: p.preco_custo ? Math.round(p.preco_custo * 100) : null,
    controla_estoque: true,
    // Documentado no webhook de produto: "estoque: Total stock = Stock +
    // Reserve Stock" — o disponível pra VENDER é o total menos o reservado
    // (carrinho/pedido em aberto segurando peça), não o total bruto.
    quantidade: Math.max(0, (p.estoque ?? 0) - (p.estoque_reserva ?? 0)),
    ativo: p.ativo,
    origem: "shoppub",
  };
}
