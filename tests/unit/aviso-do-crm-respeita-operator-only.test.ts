/**
 * INCIDENTE REAL (2026-09-21): `avisarLeadDoCrm` (o motor de handoff do
 * CRM, `lib/ai/handoff/aviso-ao-lead.ts`) mandou o aviso de escalação pra um
 * cliente real — org com os dois agentes publicados em `operator_only`
 * (sem `send_message`). Disparado por `ai.sentiment_alert` →
 * `ai-handoff-from-sentiment.handler.ts` → `triggerHandoff` (não pelo
 * motor de conversa principal, que já tinha o gate desde o incidente de
 * setembro/2026 — este é um SEGUNDO emissor, documentado no topo do
 * arquivo como "dois motores de passagem para humano, e eles não se
 * falam", que nunca ganhou a mesma checagem).
 *
 * Este teste guarda o CALL SITE (mesmo formato de
 * `operator-only-nao-manda-aviso-de-escalacao.test.ts`): lê o código-fonte
 * e confirma que o envio real (`sendMessageHandler`) só acontece depois de
 * uma checagem de `operation_mode` que pode pular o envio.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const fonte = readFileSync(
  path.join(process.cwd(), "lib/ai/handoff/aviso-ao-lead.ts"),
  "utf8",
);

describe("avisarLeadDoCrm respeita operation_mode antes de mandar mensagem", () => {
  it("a regra pura (operadorNaoFala) devolve true só pra operator_only", () => {
    // Mesma semântica de deveOmitirSendMessage — reimplementada aqui por
    // ausência de acesso ao módulo real (função privada, sem export), então
    // este bloco só documenta a expectativa; o teste de call site abaixo é
    // quem garante que a função ligada ao arquivo tem essa forma.
    const i = fonte.indexOf("function operadorNaoFala(");
    expect(i, "não achei operadorNaoFala — ENSINE ESTE TESTE se o nome mudou").toBeGreaterThan(0);
    const trecho = fonte.slice(i, i + 200);
    expect(trecho.includes('=== "operator_only"')).toBe(true);
  });

  it("devePularEnvioDoAviso roda ANTES do sendMessageHandler em avisarLeadDoCrm", () => {
    const iFuncao = fonte.indexOf("export async function avisarLeadDoCrm(");
    expect(iFuncao, "não achei avisarLeadDoCrm").toBeGreaterThan(0);

    const iCheck = fonte.indexOf("devePularEnvioDoAviso(", iFuncao);
    const iSend = fonte.indexOf("sendMessageHandler(", iFuncao);
    expect(iCheck, "a checagem de operation_mode sumiu de avisarLeadDoCrm").toBeGreaterThan(iFuncao);
    expect(iSend, "não achei a chamada real de sendMessageHandler").toBeGreaterThan(iFuncao);
    expect(
      iCheck,
      "devePularEnvioDoAviso precisa vir ANTES de sendMessageHandler — senão o envio acontece antes de saber se pode",
    ).toBeLessThan(iSend);

    // E o resultado da checagem precisa de fato interromper o envio (return
    // antes do corpo que monta e manda a mensagem), não só ser chamada e
    // ignorada.
    const trechoEntre = fonte.slice(iCheck, iSend);
    expect(trechoEntre.includes("return")).toBe(true);
    expect(trechoEntre.includes("avisado: false")).toBe(true);
  });

  it("sem agente ativo resolvível, só envia se ALGUM agente publicado não for operator_only", () => {
    const i = fonte.indexOf("devePularEnvioDoAviso(");
    const iSegundoBloco = fonte.indexOf("publicados", i);
    expect(
      iSegundoBloco,
      "o fallback pra 'nenhum agente ativo' sumiu — sem ele, uma conversa sem active_ai_agent_id voltaria a vazar",
    ).toBeGreaterThan(0);
    const trecho = fonte.slice(iSegundoBloco, iSegundoBloco + 400);
    expect(trecho.includes("algumFala")).toBe(true);
    expect(trecho.includes("return !algumFala")).toBe(true);
  });
});
