import type { Queryable } from "@/lib/agent-engine/queue/queue";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StaleServiceBoundaryError } from "@/lib/atendimento/fronteira";
export interface AgentOperationContext {
  organizationId: string;
  agentId: string;
  versionId: string;
  revision: string;
}

/**
 * Modos cujo turno chega até este boundary e precisa gravar efeito de
 * verdade no CRM. `assisted` nunca alcança aqui — o rascunho tem ramo
 * próprio em `createInboundTurnHandler` que devolve antes de qualquer efeito
 * de serviço. `operator_only` chega pelo MESMO caminho que `automatic`
 * (mesmo `executarTurnoDoAgente`), só sem `send_message` — por isso hardcode
 * em `=== "automatic"` derrubava toda gravação do Operador com
 * `StaleServiceBoundaryError`, mesmo turno certo, revisão certa, achado em
 * produção (2026-09-18): o Conferidor de Funil rodava o turno inteiro e
 * nunca conseguia salvar a etapa que decidiu mover.
 */
const MODOS_QUE_CHEGAM_NESTE_BOUNDARY = new Set(["automatic", "operator_only"]);

function assert(
  row:
    | {
        published_version_id: string | null;
        operation_revision: number | string;
        operation_mode: string;
        paused_at: string | null;
        archived_at: string | null;
      }
    | undefined
    | null,
  c: AgentOperationContext,
) {
  if (
    !row ||
    row.published_version_id !== c.versionId ||
    String(row.operation_revision) !== c.revision ||
    !MODOS_QUE_CHEGAM_NESTE_BOUNDARY.has(row.operation_mode) ||
    row.paused_at ||
    row.archived_at
  )
    throw new StaleServiceBoundaryError();
}
export async function assertAgentOperationPg(db: Queryable, c: AgentOperationContext) {
  const { rows } = await db.query<NonNullable<Parameters<typeof assert>[0]>>(
    "select published_version_id,operation_revision::text,operation_mode,paused_at,archived_at from ai_agents where organization_id=$1 and id=$2",
    [c.organizationId, c.agentId],
  );
  assert(rows[0], c);
}
export async function assertAgentOperationSupabase(db: SupabaseClient, c: AgentOperationContext) {
  const { data, error } = await db
    .from("ai_agents")
    .select("published_version_id,operation_revision,operation_mode,paused_at,archived_at")
    .eq("organization_id", c.organizationId)
    .eq("id", c.agentId)
    .maybeSingle();
  if (error) throw error;
  assert(data, c);
}
