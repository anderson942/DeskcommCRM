-- 0269 — libera 'operator_only' no CHECK de ai_agents.operation_mode
--
-- Pedido do Anderson (2026-09-17): um terceiro modo de operação pro agente de
-- IA, além de 'automatic' e 'assisted' — o agente lê cada conversa e deixa o
-- papel Operador organizar o funil (spec 16 §3.2), mas NUNCA tem a ferramenta
-- de enviar mensagem disponível nesse modo. Não é uma instrução de prompt
-- ("não fale com o cliente") — é a mesma técnica já usada pro Operador em si
-- (spec 16 §3.2: "a separação é por AUSÊNCIA, e é a única forma que não
-- depende de o modelo obedecer"), aplicada agora ao papel Conversador quando
-- este modo está ativo. Ver `lib/agent-engine/agent/inbound-turn.ts`.
--
-- Idempotente.

alter table public.ai_agents
  drop constraint if exists ai_agents_operation_mode_check;

alter table public.ai_agents
  add constraint ai_agents_operation_mode_check
  check (operation_mode in ('automatic', 'assisted', 'operator_only'));
