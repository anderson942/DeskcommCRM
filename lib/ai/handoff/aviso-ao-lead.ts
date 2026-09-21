import type { ServiceBoundary } from "@/lib/atendimento/fronteira";
/**
 * O ENVIO do aviso de escalação — lado do CRM (`supabase-js`).
 *
 * ## Por que existe um segundo emissor
 *
 * O repo tem DOIS motores de passagem para humano, e eles não se falam:
 *
 *   - `performHumanHandoff` (`lib/agent-engine/agent/human-handoff.ts`) roda no
 *     motor de conversa, sobre `pg.Pool`, dentro de um turno com job e canal;
 *   - `triggerHandoff` (`./orchestrator.ts`) roda no mundo do CRM, sobre
 *     `supabase-js`, disparado por evento (sentimento) ou por tool MCP — sem
 *     job, sem `pg.Pool`, às vezes dentro de uma requisição Next.
 *
 * Consertar só o primeiro conserta metade do defeito. A conversa `b934ba2d`
 * medida em produção em 2026-08-26 — a que ficou muda depois que a IA PERGUNTOU
 * o e-mail do cliente — foi silenciada por ESTE lado, com
 * `last_handoff_reason='low_sentiment'`.
 *
 * ## Por que o texto é o mesmo e o encanamento não
 *
 * O texto é `lib/escalacao/aviso-ao-lead.ts`, compartilhado — duas redações
 * envelheceriam separadas. O encanamento não pode ser: `runBeforeSend` exige
 * `pg.Pool` e um `job_id` para o ledger, e aqui não há nem um nem outro. Abrir
 * um pool dentro de uma rota Next para mandar uma frase seria pagar caro por
 * simetria de fachada.
 *
 * O que se perde sem a cadeia, dito com todas as letras: janela/throttle
 * anti-ban, spinning, disclosure e o gate de LGPD. O que NÃO se perde é o que
 * mais importa aqui — `sendMessageHandler` recusa contato `is_blocked` com 403
 * (`app/api/v1/messages/_handler.ts`), que é a trava irrevogável (regra dura
 * nº 2). E o aviso do lado do motor, esse sim, passa pela cadeia inteira.
 *
 * ## Ordem
 *
 * Chamado ANTES do UPDATE que silencia. Do lado do motor a ordem é obrigatória
 * (o `force_human` que ele grava arma o `stopGate` e mata o envio seguinte);
 * deste lado ela é apenas honesta — `triggerHandoff` não grava `force_human`, e
 * o silêncio que ele grava não é lido pelo caminho de envio. Mantê-la igual nos
 * dois evita que alguém "otimize" um deles sem perceber que no outro isso apaga
 * a mensagem.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { motivoDoAviso, textoDoAviso } from "@/lib/escalacao/aviso-ao-lead";
import { carregarRosterDeAtendimento, podeAssumirAgora } from "@/lib/escalacao/atendentes";
import type { QuemPodeAssumir } from "@/lib/escalacao/disponibilidade";
import { logger } from "@/lib/logger";

/** Ator do envio — é o automático falando, não uma pessoa. */
const ATOR_DO_AVISO = "handoff-orchestrator";

export interface AvisoDoCrmInput {
  serviceBoundary?: ServiceBoundary;
  organizationId: string;
  conversationId: string;
  /** `contacts.id` — semente da variante do texto (nada dele aparece na frase). */
  contactId: string;
  /** `conversations.last_handoff_reason` que está sendo gravado agora. */
  reason: string;
}

/**
 * Mesma regra pura de `deveOmitirSendMessage`
 * (`lib/agent-engine/agent/inbound-turn.ts`) — reescrita aqui, não
 * importada, de propósito: aquele arquivo carrega `pg.Pool` e o resto do
 * motor de conversa, e este módulo roda dentro de rota Next / fire-and-
 * forget do CRM (ver docstring do arquivo — "abrir um pool dentro de uma
 * rota Next... seria pagar caro"). Se a regra do lado do motor mudar, esta
 * cópia precisa mudar junto — os dois são guardados por teste de call site.
 */
function operadorNaoFala(operationMode: string | null | undefined): boolean {
  return operationMode === "operator_only";
}

/**
 * INCIDENTE (2026-09-21): este caminho mandava o aviso de escalação
 * incondicionalmente, sem saber que o agente da organização podia estar em
 * `operator_only` (sem `send_message`, por ausência de ferramenta — a mesma
 * separação que `deveOmitirSendMessage` protege do lado do motor de
 * conversa). O comentário no topo deste arquivo já dizia "dois motores de
 * passagem para humano, e eles não se falam" — e o motor do CRM nunca
 * ganhou a checagem que o motor de conversa ganhou no incidente de
 * mensagem real (setembro/2026). Medido em produção: `ai.sentiment_alert` →
 * `ai-handoff-from-sentiment.handler.ts` → `triggerHandoff` →
 * `avisarLeadDoCrm` mandou "Esse caso é melhor resolvido por uma pessoa..."
 * pra um cliente real, com os dois agentes da org publicados em
 * `operator_only`.
 *
 * Sem `agent_id` específico neste escopo (o gatilho é por sentimento/tool,
 * não por turno de um agente): olha o agente ATIVO da conversa
 * (`conversations.active_ai_agent_id`) quando existe; sem ele, cai pro modo
 * mais conservador — SÓ envia se existir pelo menos um agente publicado da
 * org que NÃO seja `operator_only`. Na dúvida, não manda: é o mesmo lado da
 * assimetria que o resto desta doutrina escolhe sempre.
 */
async function devePularEnvioDoAviso(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
): Promise<boolean> {
  const { data: conv } = await admin
    .from("conversations")
    .select("active_ai_agent_id")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const activeAgentId = (conv as { active_ai_agent_id?: string | null } | null)?.active_ai_agent_id;

  if (activeAgentId) {
    const { data: agente } = await admin
      .from("ai_agents")
      .select("operation_mode")
      .eq("organization_id", organizationId)
      .eq("id", activeAgentId)
      .maybeSingle();
    if (agente) return operadorNaoFala((agente as { operation_mode: string }).operation_mode);
  }

  // Sem agente ativo resolvível: só manda se existir ALGUM agente publicado
  // da org que fale de verdade. Nenhum agente, ou todos operator_only →
  // pula (fail-closed do lado que importa: nunca mandar por engano).
  const { data: publicados } = await admin
    .from("ai_agents")
    .select("operation_mode")
    .eq("organization_id", organizationId)
    .not("published_version_id", "is", null)
    .is("archived_at", null);
  const algumFala = (publicados ?? []).some(
    (a) => !operadorNaoFala((a as { operation_mode: string }).operation_mode),
  );
  return !algumFala;
}

/**
 * Avisa o lead. NUNCA lança: o orquestrador inteiro é fire-and-forget por
 * contrato ("nunca propaga exceção pro caller"), e um erro aqui não pode impedir
 * a passagem que ele antecede.
 */
export async function avisarLeadDoCrm(
  admin: SupabaseClient,
  input: AvisoDoCrmInput,
): Promise<{ avisado: boolean; porque?: string }> {
  try {
    if (await devePularEnvioDoAviso(admin, input.organizationId, input.conversationId)) {
      return { avisado: false, porque: "agente_nao_fala_com_cliente" };
    }
    const body = textoDoAviso(
      motivoDoAviso(input.reason),
      await quemPodeAssumir(admin, input.organizationId),
      input.contactId,
    );
    await sendMessageHandler(
      admin,
      {
        organization_id: input.organizationId,
        serviceBoundary: input.serviceBoundary,
        actor: { type: "ai_agent", id: ATOR_DO_AVISO, role: "manager" },
        requestId: `handoff-aviso-${input.conversationId}`,
      },
      {
        conversation_id: input.conversationId,
        type: "text",
        body,
        // A linha se DECLARA. Sem isto, no banco e na tela, este aviso é
        // indistinguível de uma fala do agente — e ele não é: é texto de
        // sistema, escrito em código, que sai no instante em que a IA se
        // retira. Quem audita a conversa depois precisa saber a diferença, e
        // quem escreve teste sobre este caminho também.
        metadata: { aviso_de_escalacao: true, handoff_reason: input.reason },
      },
    );
    return { avisado: true };
  } catch (err) {
    // PII fora do log: só o motivo da falha.
    const porque = err instanceof Error ? err.name : "erro_desconhecido";
    logger.warn("[handoff-orchestrator] aviso ao lead não saiu", {
      conversation_id: input.conversationId,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return { avisado: false, porque };
  }
}


/**
 * Quantos podem assumir agora, no vocabulário que o texto espera.
 *
 * Reusa `carregarRosterDeAtendimento` + `podeAssumirAgora` — o par supabase-js
 * que a rota do painel e a capacidade do agente já usam. Não é um terceiro
 * leitor: é o MESMO predicado (`isAttendantEligible`) que o motor lê por `pg` em
 * `quemPodeAssumirAgora`. Duas portas, uma régua.
 *
 * `null` quando a leitura falha — e `textoDoAviso` lê `null` como "não prometa
 * prazo", que é a direção certa do erro.
 */
async function quemPodeAssumir(
  admin: SupabaseClient,
  organizationId: string,
): Promise<QuemPodeAssumir | null> {
  try {
    const roster = await carregarRosterDeAtendimento(admin, organizationId);
    const agora = new Date();
    return {
      total: roster.length,
      disponiveis: roster.filter((a) => podeAssumirAgora(a, agora)).length,
    };
  } catch (err) {
    logger.warn("[handoff-orchestrator] disponibilidade não lida — aviso sem prazo", {
      organization_id: organizationId,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return null;
  }
}
