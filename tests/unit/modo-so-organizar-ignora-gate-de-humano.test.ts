/**
 * MODO "SÓ ORGANIZAR" (0269): NÃO PARA QUANDO UM HUMANO ESTÁ ATENDENDO.
 *
 * ## O bug real (achado em produção, 2026-09-18)
 *
 * Os dois "Conferidor de Funil" publicados no dia anterior nunca rodaram um
 * turno sequer — `llm_calls` só tinha chamadas de `sentiment_classify`
 * (mecanismo não relacionado), zero `agent_turn`/`operator_turn`, apesar de
 * um dia inteiro de conversa real nos dois números. Causa: as duas guardas
 * de "humano está atendendo" (`isLeadInHandoff` e o gate de elegibilidade,
 * em `executarTurnoDoAgente`) bloqueiam ANTES de qualquer chamada de modelo,
 * pra QUALQUER modo — certo pro automático (não quer bot e humano falando
 * junto), errado pro `operator_only`: ele não tem `send_message`
 * (`deveOmitirSendMessage`), então "humano atendendo" não é motivo pra parar
 * de organizar o funil — é justamente quando mais importa, porque é quando a
 * negociação está acontecendo de verdade. Como as vendedoras respondem
 * manualmente o dia todo, a conversa fica sempre silenciada pra IA, e o
 * Conferidor nunca passava dessas duas guardas.
 *
 * ## Os dois testes, e por que nenhum sozinho basta
 *
 * Mesmo formato de `modo-so-organizar-omite-envio.test.ts`: o primeiro guarda
 * a REGRA (`devePularGateDeHumano` é pura, rápida, sem banco). O segundo
 * guarda os CALL SITES — a função pode estar perfeita e as guardas pararem de
 * chamá-la num refactor futuro, o que reabriria o mesmo bug sem que a suíte
 * percebesse.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { devePularGateDeHumano } from "@/lib/agent-engine/agent/inbound-turn";

describe("devePularGateDeHumano", () => {
  it("operator_only pula o gate — é o modo que não fala com o cliente", () => {
    expect(devePularGateDeHumano("operator_only")).toBe(true);
  });

  it("automatic continua bloqueado — não quer bot e humano falando junto", () => {
    expect(devePularGateDeHumano("automatic")).toBe(false);
  });

  it("assisted continua bloqueado por ESTA função — tem a própria isenção em createInboundTurnHandler", () => {
    expect(devePularGateDeHumano("assisted")).toBe(false);
  });

  it("ausência de modo (undefined/null) NUNCA pula — silêncio não é o modo seguro aqui", () => {
    // Mesma direção de `deveOmitirSendMessage`: se um bug apagar o valor do
    // banco, a leitura errada tem de cair do lado que MANTÉM a guarda ligada,
    // não do lado que deixa um agente sem modo conhecido escapar do bloqueio
    // de humano.
    expect(devePularGateDeHumano(undefined)).toBe(false);
    expect(devePularGateDeHumano(null)).toBe(false);
  });
});

describe("os dois chamadores honram a decisão", () => {
  const fonte = readFileSync(
    path.join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"),
    "utf8",
  );

  it("o veto de handoff (isLeadInHandoff) está condicionado a pulaGateDeHumano", () => {
    const i = fonte.indexOf("await isLeadInHandoff(pool, tenantId, leadId)");
    expect(
      i,
      "não achei a chamada a isLeadInHandoff — ENSINE ESTE TESTE (ela pode ter mudado de forma)",
    ).toBeGreaterThan(0);

    const antes = fonte.slice(Math.max(0, i - 200), i);
    expect(
      antes.includes("!pulaGateDeHumano"),
      "a checagem de handoff não está mais isenta pra operator_only — um refactor que " +
        "preserva a chamada a isLeadInHandoff mas troca a condição reabre o bug medido " +
        "em produção (2026-09-18) sem este teste perceber.",
    ).toBe(true);

    expect(
      fonte.indexOf("devePularGateDeHumano(") >= 0 &&
        fonte.indexOf("devePularGateDeHumano(") < i,
      "pulaGateDeHumano precisa vir de devePularGateDeHumano — não de uma condição solta.",
    ).toBe(true);
  });

  it("o gate de elegibilidade também está condicionado, distinguindo bloqueio de HUMANO do de ALLOWLIST", () => {
    const i = fonte.indexOf("elegib !== null && !elegib.permite && !(pulaGateDeHumano");
    expect(
      i,
      "não achei a condição composta do gate de elegibilidade — ENSINE ESTE TESTE " +
        "(pode ter mudado de forma; confirme que operator_only ainda respeita ALLOWLIST).",
    ).toBeGreaterThan(0);

    expect(
      fonte.slice(i, i + 120).includes("!elegib.bloqueioPorAllowlist"),
      "a isenção precisa ser só pro bloqueio de HUMANO (bloqueioPorAllowlist: false) — " +
        "sem essa distinção, operator_only passaria a ignorar allowlist também, que é uma " +
        "guarda diferente (contato não autorizado) que este modo NUNCA deveria pular.",
    ).toBe(true);
  });

  it("as duas guardas ficam ANTES de qualquer resolução de agente que dependa delas — não é checagem tardia", () => {
    const iPula = fonte.indexOf("const pulaGateDeHumano = devePularGateDeHumano(");
    const iHandoff = fonte.indexOf("await isLeadInHandoff(pool, tenantId, leadId)");
    const iElegib = fonte.indexOf("elegib !== null && !elegib.permite && !(pulaGateDeHumano");
    expect(iPula).toBeGreaterThan(0);
    expect(iHandoff).toBeGreaterThan(iPula);
    expect(iElegib).toBeGreaterThan(iHandoff);
  });
});
