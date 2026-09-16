-- 0264 — preco_original_cents em catalog_products
--
-- Pedido do Anderson (2026-09-15): mostrar "de X por Y" na tela de Produtos
-- quando o produto tem promoção ativa na Tiny. `preco_cents` continua sendo o
-- preço EFETIVO (o que a IA responde/cobra); `preco_original_cents` só existe
-- quando há um "de" diferente do "por" — null pra todo produto sem promoção
-- (a imensa maioria), inclusive os de origem manual/planilha, que nunca tiveram
-- esse conceito.
--
-- Idempotente.

alter table public.catalog_products
  add column if not exists preco_original_cents bigint;

-- Nunca menor que o preço efetivo — "promoção" que custa mais caro que o
-- preço normal é dado errado, não desconto.
alter table public.catalog_products
  drop constraint if exists catalog_products_preco_original_check;
alter table public.catalog_products
  add constraint catalog_products_preco_original_check
  check (preco_original_cents is null or preco_original_cents >= preco_cents);
