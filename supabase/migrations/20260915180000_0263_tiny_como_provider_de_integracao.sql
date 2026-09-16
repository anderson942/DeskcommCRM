-- 0263 — libera "tiny" no CHECK de tenant_integrations.provider
--
-- tenant_integrations tinha o provider travado em ('nuvemshop', 'vtex',
-- 'shopify') — a integração da Tiny (ERP) não é nenhum dos três, e o
-- callback OAuth falhava com "Falha ao gravar a integração no banco" (CHECK
-- violation, silenciosa pro operador — só o log do Postgres nomeava a causa
-- real).
--
-- Idempotente: dropa e recria o constraint.

alter table public.tenant_integrations
  drop constraint if exists tenant_integrations_provider_check;

alter table public.tenant_integrations
  add constraint tenant_integrations_provider_check
  check (provider = any (array['nuvemshop', 'vtex', 'shopify', 'tiny']));
