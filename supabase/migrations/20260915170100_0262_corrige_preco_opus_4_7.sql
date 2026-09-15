-- 0262 — corrige preço do Claude Opus 4.7
--
-- Achado ao verificar o catálogo pra adicionar Fable/Opus 4.6 (migration 0261):
-- Opus 4.7 estava cadastrado a $15/$75 por milhão de tokens. Preço oficial
-- verificado em claude.com/pricing (2026-09-15): $5/$25 — mesma faixa dos
-- outros Opus legados (4.6, 4.8). Preço errado aqui infla o orçamento de IA
-- calculado pra quem usa esse modelo.

update public.ai_models set
  input_price_per_million_cents = 500,
  output_price_per_million_cents = 2500
where provider = 'anthropic' and model_id = 'claude-opus-4-7';

update public.ai_pricing set
  prompt_cents_per_million_tokens = 500,
  completion_cents_per_million_tokens = 2500,
  notes = 'catálogo 0262 — corrigido de 1500/7500 para 500/2500',
  superseded_at = null
where model = 'claude-opus-4-7';
