/**
 * INCIDENTE REAL EM PRODUÇÃO (2026-09-18): o Conferidor de Funil
 * (`operation_mode='operator_only'`, sem `send_message` — `deveOmitirSendMessage`)
 * mandou mensagem de verdade pra clientes reais ao reavaliar conversas
 * antigas. A causa não foi a ferramenta `send_message`: foram TRÊS envios
 * DETERMINÍSTICOS de código, fora de qualquer ferramenta, que nunca checavam
 * `operation_mode` — a técnica de "ausência de ferramenta" só protege o que
 * passa pela ferramenta.
 *
 *   1. Handoff explícito ("quero falar com atendente" numa mensagem antiga)
 *      → `avisarLeadDaEscalacao` direto, sem checar o modo.
 *   2. Opt-out ambíguo ("para de mandar isso") → mesmo emissor, mesmo buraco.
 *   3. A tool `request_human_handoff` (que CONTINUA disponível pro
 *      operator_only — é ação de CRM legítima) tem seu próprio "piso": se o
 *      modelo não falou nada (`seq===0`), o CÓDIGO avisa o lead por ele —
 *      mesmo buraco, um nível mais fundo.
 *
 * De brinde, achado revisando os arredores: `send_template` é OUTRA
 * ferramenta de falar com o cliente, separada de `send_message` — só era
 * removida quando o canal não exige template (WAHA), nunca por causa do
 * modo. Um canal que exigisse template deixaria isso passar batido.
 *
 * Cada teste aqui é um GUARDA DE CALL SITE (mesmo formato de
 * `modo-so-organizar-omite-envio.test.ts`): a regra pura já está coberta
 * (`deveOmitirSendMessage`); o que quebra em silêncio é um refactor que
 * mexe no texto ao redor da chamada sem que a suíte perceba.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const fonte = readFileSync(
  path.join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"),
  "utf8",
);

describe("os três envios determinísticos respeitam deveOmitirSendMessage", () => {
  it("handoff explícito (pediu_humano) só envia quando o agente pode falar", () => {
    const i = fonte.indexOf("motivo: 'pediu_humano',");
    expect(i, "não achei o bloco de handoff explícito — ENSINE ESTE TESTE").toBeGreaterThan(0);
    // As duas ocorrências de 'pediu_humano' (bloco determinístico + tool
    // request_human_handoff) precisam estar as DUAS sob a guarda.
    const ocorrencias = [...fonte.matchAll(/motivo: 'pediu_humano',/g)];
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2);
    for (const m of ocorrencias) {
      const antes = fonte.slice(Math.max(0, m.index! - 400), m.index!);
      expect(
        antes.includes("deveOmitirSendMessage("),
        "uma ocorrência de 'pediu_humano' não está mais condicionada a deveOmitirSendMessage",
      ).toBe(true);
    }
  });

  it("opt-out ambíguo (suspeita_de_opt_out) só envia quando o agente pode falar", () => {
    const i = fonte.indexOf("motivo: 'suspeita_de_opt_out',");
    expect(i, "não achei o bloco de opt-out ambíguo — ENSINE ESTE TESTE").toBeGreaterThan(0);
    const antes = fonte.slice(Math.max(0, i - 300), i);
    expect(antes.includes("deveOmitirSendMessage(")).toBe(true);
  });

  it("o 'piso' de aviso dentro da tool request_human_handoff não avisa (nem mente 'avisado:true') pro operator_only", () => {
    const iTool = fonte.indexOf("request_human_handoff: tool({");
    expect(iTool, "não achei a definição da tool request_human_handoff").toBeGreaterThan(0);
    const iAviso = fonte.indexOf("const aviso = deveOmitirSendMessage(agentConfig?.operationMode)", iTool);
    expect(
      iAviso,
      "o piso da tool request_human_handoff não está mais condicionado a deveOmitirSendMessage",
    ).toBeGreaterThan(iTool);
    const trecho = fonte.slice(iAviso, iAviso + 400);
    expect(
      trecho.includes("avisado: false"),
      "quando o agente não pode falar, o resultado tem de ser avisado:false — avisado:true seria mentira pro resto do fluxo",
    ).toBe(true);
  });

  it("send_template também é removida quando o agente não pode falar, não só quando o canal dispensa template", () => {
    const i = fonte.indexOf("delete rawTools.send_template;");
    expect(i, "não achei a remoção de send_template").toBeGreaterThan(0);
    const antes = fonte.slice(Math.max(0, i - 250), i);
    expect(
      antes.includes("deveOmitirSendMessage("),
      "send_template só sai por causa da capacidade do canal — um canal que EXIGE template deixaria operator_only com essa ferramenta disponível",
    ).toBe(true);
  });
});
