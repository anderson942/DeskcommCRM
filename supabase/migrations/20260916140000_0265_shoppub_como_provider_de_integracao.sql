-- 0265 — libera "shoppub" nos CHECKs de provider (tenant_integrations e webhook_events_log)
--
-- Decisão do Anderson (2026-09-16): a Shoppub (a loja virtual em si,
-- outlet360.com.br) vira a fonte de preço/estoque do catálogo no lugar da
-- Tiny — o preço promocional é ajustado DENTRO da Shoppub e nunca chega na
-- Tiny, então o catálogo sincronizado da Tiny ficava sistematicamente
-- desatualizado. Diferente da Tiny (só polling, sem webhook), a Shoppub
-- empurra mudança de preço/estoque por webhook — cron sai de cena.
--
-- Mesmo formato da 0263 (tiny) pro provider de tenant_integrations. O CHECK
-- de webhook_events_log precisa do mesmo tratamento: a Shoppub não assina
-- HMAC (diferente da Nuvemshop), então o log registra o evento pelo
-- provider 'shoppub' mesmo assim — autenticidade vem do token opaco na URL
-- do webhook (`webhook_path_token`), não de assinatura.
--
-- Idempotente: dropa e recria os dois constraints.

alter table public.tenant_integrations
  drop constraint if exists tenant_integrations_provider_check;

alter table public.tenant_integrations
  add constraint tenant_integrations_provider_check
  check (provider = any (array['nuvemshop', 'vtex', 'shopify', 'tiny', 'shoppub']));

alter table public.webhook_events_log
  drop constraint if exists webhook_events_log_provider_check;

alter table public.webhook_events_log
  add constraint webhook_events_log_provider_check
  check (provider = any (array['waha', 'nuvemshop', 'shoppub', 'generic']));
