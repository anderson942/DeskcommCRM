-- 0261 — catálogo curado: Fable 5.1, Fable 5 e Opus 4.6 entram
--
-- Faltavam três modelos Anthropic na lista curada (`ai_models`, source
-- 'manual'): Claude Fable 5.1, Claude Fable 5 e Claude Opus 4.6. A tela de
-- Provedores de IA só oferece o que está aqui — o catálogo da OpenRouter
-- (sync automático, `sync-model-catalog`) não alimenta esta tabela.
--
-- IDS VERIFICADOS NO PROVEDOR (2026-09-15):
--   GET https://api.anthropic.com/v1/models → claude-fable-5-1, claude-fable-5,
--       claude-opus-4-6 (confirmados na resposta, junto dos já cadastrados
--       claude-opus-5, claude-sonnet-5, claude-opus-4-8, claude-opus-4-7,
--       claude-sonnet-4-6, claude-haiku-4-5-20251001)
--
-- PREÇOS VERIFICADOS EM claude.com/pricing (2026-09-15), em CENTAVOS por
-- milhão de tokens (mesma unidade das duas tabelas):
--   Fable 5.1  — $10 / $50   → 1000 / 5000
--   Fable 5    — $10 / $50   → 1000 / 5000  (legado, mesmo preço da 5.1)
--   Opus 4.6   — $5  / $25   → 500  / 2500  (legado, mesmo preço do Opus 5)
--
-- Idempotente: `on conflict do update`, seguro em re-aplicação.

insert into public.ai_models
  (provider, model_id, display_name, description,
   input_price_per_million_cents, output_price_per_million_cents, supports_tools)
values
  ('anthropic', 'claude-fable-5-1', 'Claude Fable 5.1',
   'O mais recente da linha Fable da Anthropic.', 1000, 5000, true),
  ('anthropic', 'claude-fable-5',   'Claude Fable 5',
   'Geração anterior do Fable.', 1000, 5000, true),
  ('anthropic', 'claude-opus-4-6',  'Claude Opus 4.6',
   'Geração anterior do Opus.', 500, 2500, true)
on conflict (provider, model_id) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  input_price_per_million_cents = excluded.input_price_per_million_cents,
  output_price_per_million_cents = excluded.output_price_per_million_cents,
  supports_tools = excluded.supports_tools;

-- Contabilidade de custo — a MESMA lista, senão o gasto desses modelos não é
-- calculado (some do orçamento da organização).
insert into public.ai_pricing
  (model, prompt_cents_per_million_tokens, completion_cents_per_million_tokens, notes)
values
  ('claude-fable-5-1', 1000, 5000, 'catálogo 0261'),
  ('claude-fable-5',   1000, 5000, 'catálogo 0261'),
  ('claude-opus-4-6',   500, 2500, 'catálogo 0261')
on conflict (model) do update set
  prompt_cents_per_million_tokens = excluded.prompt_cents_per_million_tokens,
  completion_cents_per_million_tokens = excluded.completion_cents_per_million_tokens,
  notes = excluded.notes,
  superseded_at = null;
