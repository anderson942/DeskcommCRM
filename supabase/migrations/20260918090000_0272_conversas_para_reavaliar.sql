-- 0272 — lista de conversas elegíveis para "reavaliar com IA" (rota
-- POST /api/v1/ai/agents/:id/reavaliar).
--
-- Achado em produção (2026-09-18): os dois agentes "Conferidor de Funil"
-- (operation_mode='operator_only') nunca rodaram um turno sequer desde que
-- foram publicados — a guarda de "humano está atendendo" bloqueava TODO
-- turno, porque a vendedora responde manualmente o dia inteiro (corrigido em
-- `lib/agent-engine/agent/inbound-turn.ts`, `devePularGateDeHumano`). Este
-- botão reprocessa, sob demanda, as conversas que já aconteceram enquanto o
-- bug estava ativo — reemitindo `ai_agent.dispatch_requested` pra ÚLTIMA
-- mensagem inbound de cada uma, pelo MESMO caminho que uma mensagem nova usa
-- (`lib/channels/pos-entrada.ts`, `pedirDespachoDoAgente`).
--
-- Só entra conversa com pelo menos 1 mensagem inbound — sem isso não há o
-- que reemitir, e a rota descarta silenciosamente.
--
-- Idempotente.

create or replace function public.fn_conversas_para_reavaliar(
  p_organization_id uuid,
  p_channel_session_id uuid,
  p_desde timestamptz
)
returns table (
  conversation_id uuid,
  contact_id uuid,
  ultima_mensagem_inbound_id uuid
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      c.id as conversation_id,
      c.contact_id,
      (
        select m.id from public.messages m
        where m.conversation_id = c.id and m.direction = 'inbound'
        order by m.created_at desc
        limit 1
      ) as ultima_mensagem_inbound_id
    from public.conversations c
    where c.organization_id = p_organization_id
      and c.channel_session_id = p_channel_session_id
      and coalesce(c.is_group, false) = false
      and c.last_inbound_at >= p_desde
  )
  select conversation_id, contact_id, ultima_mensagem_inbound_id
  from base
  where ultima_mensagem_inbound_id is not null;
$$;

revoke all on function public.fn_conversas_para_reavaliar(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.fn_conversas_para_reavaliar(uuid, uuid, timestamptz) to authenticated, service_role;
