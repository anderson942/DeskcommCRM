import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/ai/agents/:id/reavaliar (admin)  body: { desde, confirmar? }
 *
 * Achado em produção (2026-09-18): agentes `operation_mode='operator_only'`
 * publicados antes da correção em `lib/agent-engine/agent/inbound-turn.ts`
 * (`devePularGateDeHumano`) nunca rodaram um turno sequer — a guarda de
 * "humano está atendendo" bloqueava tudo, e um canal com atendimento manual
 * ativo está SEMPRE nesse estado. Esta rota reprocessa sob demanda: reemite
 * `ai_agent.dispatch_requested` pra última mensagem inbound de cada conversa
 * elegível, pelo MESMO caminho que uma mensagem nova usa
 * (`lib/channels/pos-entrada.ts`).
 *
 * Restrita a `operation_mode==='operator_only'` de propósito: esse é o único
 * modo em que reemitir o evento é seguro sem o cliente perceber nada — ele
 * nunca teve `send_message` disponível (`deveOmitirSendMessage`). Para
 * automatic/assisted, reemitir despacharia uma resposta de verdade pra uma
 * mensagem antiga — feature diferente, não pedida.
 *
 * `confirmar:false` (padrão) é um DRY RUN — só conta quantas conversas
 * entrariam, sem gastar nada. Só com `confirmar:true` os eventos saem.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

const reavaliarSchema = z.object({
  desde: z.string().datetime({ offset: true }),
  confirmar: z.boolean().optional(),
});

interface ConversaParaReavaliar {
  conversation_id: string;
  contact_id: string;
  ultima_mensagem_inbound_id: string;
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });

  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user: authUser, org: activeOrg } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", t("Body JSON inválido."), 400, { requestId });
  }
  const parsed = reavaliarSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const { desde, confirmar } = parsed.data;

  const admin = createAdminClient();

  const { data: agente } = await admin
    .from("ai_agents")
    .select("id, name, operation_mode, published_version_id, archived_at")
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (!agente) return fail("not_found", t("Agent não encontrado."), 404, { requestId });
  if (agente.archived_at) return fail("state_conflict", t("Agent arquivado."), 409, { requestId });
  if (agente.operation_mode !== "operator_only") {
    return fail(
      "state_conflict",
      t("Reavaliar só existe para agentes no modo \"Só organizar\" — este agente pode responder de verdade."),
      409,
      { requestId },
    );
  }
  if (!agente.published_version_id) {
    return fail("state_conflict", t("Agent sem versão publicada."), 409, { requestId });
  }

  const { data: versao } = await admin
    .from("ai_agent_versions")
    .select("id, channel_session_id")
    .eq("id", agente.published_version_id)
    .maybeSingle();

  if (!versao?.channel_session_id) {
    return fail(
      "state_conflict",
      t("A versão publicada deste agente não está ligada a nenhum número de WhatsApp."),
      409,
      { requestId },
    );
  }

  const { data: conversas, error: erroConsulta } = await admin.rpc(
    "fn_conversas_para_reavaliar" as never,
    {
      p_organization_id: activeOrg.orgId,
      p_channel_session_id: versao.channel_session_id,
      p_desde: desde,
    } as never,
  );

  if (erroConsulta) {
    return fail("internal_error", t("Erro ao listar as conversas."), 500, { requestId });
  }

  const elegiveis = (conversas ?? []) as ConversaParaReavaliar[];

  if (!confirmar) {
    return ok({ dry_run: true, total: elegiveis.length }, { requestId });
  }

  const resultados = await Promise.allSettled(
    elegiveis.map((c) =>
      admin.rpc("emit_event" as never, {
        p_event_type: "ai_agent.dispatch_requested",
        p_entity_kind: "message",
        p_entity_id: c.ultima_mensagem_inbound_id,
        p_payload: {
          organization_id: activeOrg.orgId,
          conversation_id: c.conversation_id,
          contact_id: c.contact_id,
          channel_session_id: versao.channel_session_id,
          inbound_message_id: c.ultima_mensagem_inbound_id,
        },
        p_metadata: { source: "reavaliar_manual", request_id: requestId },
        p_organization_id: activeOrg.orgId,
      } as never),
    ),
  );

  const enfileiradas = resultados.filter(
    (r) => r.status === "fulfilled" && !(r.value as { error?: unknown }).error,
  ).length;
  const falhas = elegiveis.length - enfileiradas;

  void audit({
    action: "ai_agent.reavaliado",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "ai_agent",
    resourceId: id,
    requestId,
    metadata: { desde, total: elegiveis.length, enfileiradas, falhas },
  });

  return ok({ dry_run: false, total: elegiveis.length, enfileiradas, falhas }, { requestId });
}
