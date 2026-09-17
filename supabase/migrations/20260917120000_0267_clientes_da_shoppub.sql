-- 0267 — commerce_customers: histórico de compra sincronizado da Shoppub
--
-- Pedido do Anderson (2026-09-17): mostrar informação de compra no painel
-- do contato, dentro do Inbox — hoje a seção "Pedidos recentes" existe na
-- tela e fica sempre vazia. A Shoppub já devolve um RESUMO pronto por
-- cliente (total gasto, quantidade de pedidos, ticket médio, data do
-- último pedido) — sem precisar processar pedido a pedido.
--
-- A API não tem busca por telefone/e-mail (`GET /clientes/` só filtra por
-- CPF/CNPJ/tipo — verificado direto na doc, 2026-09-17), e a loja tem
-- 53 mil clientes: perguntar "qual cliente é esse contato" ao vivo, toda
-- vez que o Inbox abre uma conversa, paginaria milhares de páginas. Por
-- isso existe esta tabela — sincronizada uma vez (like o catálogo),
-- consultada localmente por telefone quando o painel do contato abre.
--
-- Tabela GENÉRICA por provider (`origem`), mesmo molde de `catalog_products`
-- — outro provider de e-commerce um dia cabe aqui sem migration nova.
--
-- Idempotente.

create table if not exists public.commerce_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  origem text not null,
  external_id text not null,
  -- E.164 (lib/webhooks/inbound.ts normalizePhoneBR) — é o formato que
  -- contacts.phone_number já usa, então o match é uma igualdade direta,
  -- sem normalizar dos dois lados toda vez que o painel abre.
  telefone_e164 text,
  nome text,
  email text,
  total_gasto_cents bigint,
  quantidade_pedidos integer,
  quantidade_pedidos_pagos integer,
  ticket_medio_cents bigint,
  data_ultimo_pedido timestamptz,
  bloqueado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_customers_org_origem_external_key unique (organization_id, origem, external_id)
);

create index if not exists commerce_customers_telefone_idx
  on public.commerce_customers (organization_id, telefone_e164)
  where telefone_e164 is not null;

alter table public.commerce_customers enable row level security;

-- Mesmo molde da 17278 (catalog_products): leitura pra organização,
-- escrita só de manager+ — é histórico de compra, não campo que um agent
-- comum edita à mão (a sincronização grava como service_role, que ignora
-- RLS de qualquer forma).
drop policy if exists commerce_customers_select on public.commerce_customers;
create policy commerce_customers_select on public.commerce_customers
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );

drop policy if exists commerce_customers_write on public.commerce_customers;
create policy commerce_customers_write on public.commerce_customers
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.commerce_customers from anon;
grant select, insert, update, delete on public.commerce_customers to authenticated;
grant all on public.commerce_customers to service_role;

drop trigger if exists trg_commerce_customers_updated_at on public.commerce_customers;
create trigger trg_commerce_customers_updated_at
  before update on public.commerce_customers
  for each row execute function public.fn_set_updated_at();
