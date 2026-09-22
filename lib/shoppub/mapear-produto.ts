/**
 * Um produto da Shoppub → a linha que `catalog_products` espera.
 *
 * Compartilhado entre o webhook (`app/api/v1/webhooks/shoppub/[token]`) e o
 * backfill (`app/api/v1/cron/shoppub-backfill`) — mesma regra nos dois
 * lugares, não duas cópias que podem divergir.
 */
import type { ShoppubImagemDeProduto, ShoppubProduto } from "./api-client";

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

/**
 * `categorias` do produto é uma lista de IDS, sem nome — a Shoppub não
 * embute o nome ali (diferente de `fabricante_info`, que já vem pronto).
 * Junta os nomes resolvidos com ", "; ID sem correspondência no mapa (grupo
 * apagado, ou o mapa não cobriu por algum erro de paginação) é OMITIDO em
 * vez de aparecer como número cru — melhor faltar uma categoria que mostrar
 * "482" pro operador.
 */
function resolverCategorias(p: ShoppubProduto, mapaCategorias: Map<number, string>): string | null {
  const nomes = (p.categorias ?? []).map((id) => mapaCategorias.get(id)).filter((n): n is string => !!n);
  return nomes.length > 0 ? nomes.join(", ") : null;
}

/**
 * O host vem de fora (não do produto): é o domínio DA LOJA, o mesmo que
 * `tenant_integrations.store_metadata.subdominio` guarda pra montar a URL
 * da API. Padrão confirmado contra a loja real (2026-09-16), não
 * adivinhado: `GET https://www.outlet360.com.br/produto/{slug}/` → 200 num
 * produto ativo de verdade.
 *
 * `mapaCategorias` (id → nome) vem de `ShoppubApiClient.obterCategorias()`,
 * buscado UMA VEZ por rodada de sync (webhook ou backfill) e reaproveitado
 * pra todo produto daquela rodada — a lista de categorias é pequena e
 * muda raro, não vale uma chamada de API por produto.
 */
/**
 * Qual das imagens do produto é A imagem (a tela mostra uma miniatura só,
 * não a galeria inteira). `principal` é o sinal que a própria Shoppub dá
 * pra isso; sem nenhuma marcada, a de `order` mais baixo é a convenção mais
 * razoável (primeira da vitrine); lista vazia → sem foto, `null` é honesto.
 */
export function imagemPrincipal(imagens: readonly ShoppubImagemDeProduto[]): string | null {
  if (imagens.length === 0) return null;
  const marcada = imagens.find((i) => i.principal);
  if (marcada) return marcada.foto;
  return [...imagens].sort((a, b) => a.order - b.order)[0]!.foto;
}

export function mapearProduto(
  p: ShoppubProduto,
  orgId: string,
  host: string,
  mapaCategorias: Map<number, string>,
) {
  return {
    organization_id: orgId,
    codigo: p.sku,
    nome: p.nome,
    // Já vem EMBUTIDO na listagem (`fabricante_info`) — sem chamada extra,
    // diferente de categoria.
    marca: p.fabricante_info?.nome ?? null,
    categoria: resolverCategorias(p, mapaCategorias),
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
    url_produto: p.slug ? `https://${host}/produto/${p.slug}/` : null,
  };
}
