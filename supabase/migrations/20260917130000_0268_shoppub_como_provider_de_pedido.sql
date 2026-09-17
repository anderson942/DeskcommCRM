-- 0268 — libera "shoppub" no CHECK de orders.external_provider
--
-- Pedido do Anderson (2026-09-17): a seção "Pedidos recentes" do painel de
-- contato no Inbox já existe na tela (`components/inbox/CRMSidePanel.tsx`,
-- lê `orders` via `/api/v1/contacts/[id]/crm-summary`) e sempre aparece
-- vazia — a tabela `orders` existe desde o schema original (pensada pra
-- Nuvemshop/VTEX/Shopify) mas nenhuma integração desta instalação nunca
-- escreveu nela de verdade (achado ao procurar: só o seed de teste e2e
-- inseria linha aqui). Mesmo formato da 0263/0265 (drop + recria).
--
-- Idempotente.

alter table public.orders
  drop constraint if exists orders_external_provider_check;

alter table public.orders
  add constraint orders_external_provider_check
  check (external_provider = any (array['nuvemshop', 'vtex', 'shopify', 'shoppub']));
