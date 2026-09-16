-- 0266 — url_produto em catalog_products
--
-- Pedido do Anderson (2026-09-16): o agente de IA responder o link da
-- página do produto, não só nome/preço. A Shoppub devolve `slug` por
-- produto, e o padrão real da loja foi confirmado direto (não adivinhado):
-- GET https://www.outlet360.com.br/produto/{slug}/ → 200 num produto ativo
-- de verdade (bone-rl-classic-chumbo). Populado por `lib/shoppub/mapear-
-- produto.ts`; null pra origem que não tem esse conceito (manual/planilha/
-- tiny — a Tiny não expõe link de loja).
--
-- Idempotente.

alter table public.catalog_products
  add column if not exists url_produto text;
