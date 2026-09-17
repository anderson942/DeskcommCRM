/**
 * "SÓ ORGANIZAR" NÃO TOMA O ATALHO DO MODO ASSISTIDO.
 *
 * O ramo assistido de `createInboundTurnHandler` (0227) devolve ANTES de
 * chegar ao turno de verdade — é aonde o checkpoint fecha e o Operador é
 * enfileirado (ver `tests/unit/modo-so-organizar-omite-envio.test.ts`, que
 * guarda a remoção da ferramenta). Se o novo modo `operator_only` caísse
 * nesse MESMO early-return (por exemplo, um `||` cedo demais na condição em
 * vez de `===`), o resultado observável seria idêntico ao assistido: um
 * rascunho gerado, e o Operador NUNCA rodando — o oposto do que este modo
 * existe para fazer.
 *
 * O harness é o mesmo de `assistido-respeita-o-gate.test.ts`, de propósito
 * (mudar só a variável em teste — mesmo `operationMode`, resto idêntico). A
 * chamada ao handler pode falhar mais adiante, dentro do turno de verdade,
 * porque este mock de `pool` é raso demais pra sustentar o turno inteiro —
 * isso é aceitável aqui: a asserção que importa (`generateReplyDraft` nunca
 * chamado) já vale antes de qualquer coisa mais funda quebrar.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishedAgentConfig } from "@/lib/agent-engine/agent/agent-config";

const mocks = vi.hoisted(() => ({
  router: vi.fn(),
  classify: vi.fn(),
  byId: vi.fn(),
  bySession: vi.fn(),
  conversationAgent: vi.fn(),
  draft: vi.fn(),
  operation: vi.fn(),
  handoff: vi.fn(),
  elegibilidade: vi.fn(),
}));
vi.mock("@/lib/agent-engine/agent/router-config", () => ({ loadActiveRouter: mocks.router }));
vi.mock("@/lib/agent-engine/agent/intent-classifier", () => ({ classifyIntent: mocks.classify }));
vi.mock("@/lib/agent-engine/agent/agent-config", () => ({
  loadPublishedAgentConfigById: mocks.byId,
  loadPublishedAgentConfig: mocks.bySession,
  loadConversationAgentConfig: mocks.conversationAgent,
}));
vi.mock("@/lib/agent-engine/agent/reply-drafts", () => ({ generateReplyDraft: mocks.draft }));
vi.mock("@/lib/atendimento/fronteira-server", () => ({
  currentExecutionBoundary: () => undefined,
  setExecutionAgentOperation: mocks.operation,
  guardServiceEffect: vi.fn(),
}));
vi.mock("@/lib/agent-engine/agent/human-handoff", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isLeadInHandoff: mocks.handoff,
}));
vi.mock("@/lib/agent-engine/guardrails/camadas-da-org", () => ({
  lerCamadasDaOrg: vi.fn(async () => ({})),
  camadaLigada: vi.fn(() => false),
}));
vi.mock("@/lib/agent-engine/agent/fuso-da-org", () => ({ fusoDaOrganizacao: vi.fn(async () => "UTC") }));
vi.mock("@/lib/ai/elegibilidade/consulta-pg", () => ({ decidirElegibilidadeDaConversa: mocks.elegibilidade }));
vi.mock("@/lib/agent-engine/pacing/store", () => ({ loadChannelKnobs: vi.fn(async () => ({ knobs: {} })) }));
vi.mock("@/lib/agent-engine/pacing/engine", () => ({
  janelaDeEnvioAberta: () => true,
  proximaAberturaDaJanela: vi.fn(),
}));
vi.mock("@/lib/agent-engine/pacing/aviso-de-janela", () => ({
  resolverAvisoDeJanela: vi.fn(async () => 0),
  avisarJanelaFechada: vi.fn(),
}));

import { createInboundTurnHandler, type InboundTurnDeps } from "@/lib/agent-engine/agent/inbound-turn";

const ids = {
  org: "12000000-0000-4000-8000-000000000001",
  contact: "12000000-0000-4000-8000-000000000002",
  conversation: "12000000-0000-4000-8000-000000000003",
  channel: "12000000-0000-4000-8000-000000000004",
  job: "12000000-0000-4000-8000-000000000005",
};
const job = {
  id: ids.job,
  organization_id: ids.org,
  contact_id: ids.contact,
  kind: "inbound_turn",
  payload: {
    conversation_id: ids.conversation,
    contact_id: ids.contact,
    channel_session_id: ids.channel,
    inbound_message_id: "12000000-0000-4000-8000-000000000006",
    crm_event_id: "12000000-0000-4000-8000-000000000007",
  },
};
const deps = {
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  llmCfg: {},
  crmCfg: {},
  knobs: {},
} as unknown as InboundTurnDeps;
const soOrganizar = {
  agentId: "A",
  versionId: "version-A",
  operationRevision: "7",
  operationMode: "operator_only",
  pausedAt: null,
} as PublishedAgentConfig;

function pool() {
  mocks.router.mockResolvedValue(null);
  mocks.byId.mockResolvedValue(soOrganizar);
  mocks.bySession.mockResolvedValue(soOrganizar);
  mocks.conversationAgent.mockResolvedValue(soOrganizar);
  return { query: vi.fn(async () => ({ rows: [{ active_ai_agent_id: null, active_intent: null, body: "oi" }] })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handoff.mockResolvedValue(false);
  mocks.elegibilidade.mockResolvedValue(null);
});

describe("operator_only não é tratado como assisted", () => {
  it("gate aberto → NENHUM rascunho é gerado (não é o caminho do modo assistido)", async () => {
    mocks.elegibilidade.mockResolvedValue({ permite: true, motivo: "gate_aberto" });
    const p = pool();
    try {
      await createInboundTurnHandler(deps)(job as never, p as never, { workerId: "worker" });
    } catch {
      // O mock de `pool` é raso demais pra sustentar o turno de verdade além
      // deste ponto — aceitável, ver o comentário do arquivo. O que importa
      // já foi decidido antes de qualquer exceção chegar aqui.
    }
    expect(
      mocks.draft,
      "operator_only tomou o atalho do modo assistido — o Operador nunca vai rodar",
    ).not.toHaveBeenCalled();
  });

  it("chega a montar a operação do agente — prova que passou dos dois early-returns do assisted", async () => {
    mocks.elegibilidade.mockResolvedValue({ permite: true, motivo: "gate_aberto" });
    const p = pool();
    try {
      await createInboundTurnHandler(deps)(job as never, p as never, { workerId: "worker" });
    } catch {
      // idem acima
    }
    expect(
      mocks.operation,
      "não chegou a setExecutionAgentOperation — ficou preso em algum early-return do modo assistido",
    ).toHaveBeenCalledOnce();
  });
});
