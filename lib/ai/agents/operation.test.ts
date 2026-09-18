import { describe, expect, it, vi } from "vitest";

import { assertAgentOperationPg, type AgentOperationContext } from "./operation";
import { StaleServiceBoundaryError } from "@/lib/atendimento/fronteira";

/**
 * O BOUNDARY ANTI-STALENESS DE `ai_agents` (agrupa versão publicada + revisão
 * de operação) — achado em produção (2026-09-18): `operation_mode !== "automatic"`
 * hardcoded aqui derrubava TODA gravação do Operador para um agente
 * `operator_only` com `StaleServiceBoundaryError`, mesmo com a versão e a
 * revisão corretas — o Conferidor de Funil rodava o turno inteiro (LLM
 * chamado, decisão tomada) e nunca conseguia salvar a etapa que decidiu
 * mover. `assisted` nunca alcança este boundary (ramo próprio em
 * `createInboundTurnHandler`), então não faz parte deste teste.
 */

const CTX: AgentOperationContext = {
  organizationId: "22222222-2222-4222-8222-222222222222",
  agentId: "33333333-3333-4333-8333-333333333333",
  versionId: "44444444-4444-4444-8444-444444444444",
  revision: "1",
};

function linhaOk(over: Partial<{ operation_mode: string }> = {}) {
  return {
    published_version_id: CTX.versionId,
    operation_revision: "1",
    operation_mode: "automatic",
    paused_at: null,
    archived_at: null,
    ...over,
  };
}

function dbCom(linha: unknown) {
  return { query: vi.fn(async () => ({ rows: [linha] })) };
}

describe("assertAgentOperationPg", () => {
  it("automatic com versão/revisão corretas passa", async () => {
    await expect(assertAgentOperationPg(dbCom(linhaOk()) as never, CTX)).resolves.toBeUndefined();
  });

  it("operator_only com versão/revisão corretas TAMBÉM passa — mesmo caminho que automatic", async () => {
    await expect(
      assertAgentOperationPg(dbCom(linhaOk({ operation_mode: "operator_only" })) as never, CTX),
    ).resolves.toBeUndefined();
  });

  it("assisted continua rejeitado — nunca deveria alcançar este boundary", async () => {
    await expect(
      assertAgentOperationPg(dbCom(linhaOk({ operation_mode: "assisted" })) as never, CTX),
    ).rejects.toThrow(StaleServiceBoundaryError);
  });

  it("versão publicada diferente da esperada continua rejeitada, em qualquer modo", async () => {
    const linha = { ...linhaOk({ operation_mode: "operator_only" }), published_version_id: "outra-versao" };
    await expect(assertAgentOperationPg(dbCom(linha) as never, CTX)).rejects.toThrow(
      StaleServiceBoundaryError,
    );
  });

  it("revisão de operação diferente continua rejeitada, em qualquer modo", async () => {
    const linha = { ...linhaOk({ operation_mode: "operator_only" }), operation_revision: "2" };
    await expect(assertAgentOperationPg(dbCom(linha) as never, CTX)).rejects.toThrow(
      StaleServiceBoundaryError,
    );
  });

  it("agente pausado ou arquivado continua rejeitado, em qualquer modo", async () => {
    const pausado = { ...linhaOk({ operation_mode: "operator_only" }), paused_at: "2026-09-18T00:00:00Z" };
    await expect(assertAgentOperationPg(dbCom(pausado) as never, CTX)).rejects.toThrow(
      StaleServiceBoundaryError,
    );

    const arquivado = { ...linhaOk({ operation_mode: "operator_only" }), archived_at: "2026-09-18T00:00:00Z" };
    await expect(assertAgentOperationPg(dbCom(arquivado) as never, CTX)).rejects.toThrow(
      StaleServiceBoundaryError,
    );
  });

  it("agente não encontrado continua rejeitado", async () => {
    await expect(assertAgentOperationPg(dbCom(undefined) as never, CTX)).rejects.toThrow(
      StaleServiceBoundaryError,
    );
  });
});
