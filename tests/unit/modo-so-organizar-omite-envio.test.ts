/**
 * MODO "SÓ ORGANIZAR" (0269): O CONVERSADOR NUNCA TEM `send_message`.
 *
 * ## Por que ausência, não instrução
 *
 * A spec 16 §3.2 já fechou essa lição pro papel Operador: "a separação é por
 * AUSÊNCIA, e é a única forma que não depende de o modelo obedecer". Este
 * modo aplica a MESMA técnica ao Conversador quando `operation_mode` é
 * `'operator_only'` — em vez de pedir por prompt "não fale com o cliente",
 * `send_message` nem entra na lista de ferramentas que o modelo recebe.
 *
 * ## Os dois testes, e por que nenhum sozinho basta
 *
 * O primeiro guarda a REGRA (`deveOmitirSendMessage` é pura, rápida, sem
 * banco). O segundo guarda o CALL SITE, no mesmo formato que
 * `operador-enfileiramento.test.ts` já usa pra `decidirSeEnfileiraOperador`:
 * a função pode estar perfeita e o turno parar de chamá-la num refactor
 * futuro — é o mesmo formato de lacuna que já morde este arquivo (comentário
 * da spec 16: "uma sabotagem já encontrou nesta série"). Sem o segundo teste,
 * apagar o `if` que chama `deveOmitirSendMessage` deixaria a suíte inteira
 * verde com o vazamento reaberto.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { deveOmitirSendMessage } from "@/lib/agent-engine/agent/inbound-turn";

describe("deveOmitirSendMessage", () => {
  it("operator_only omite a ferramenta de enviar", () => {
    expect(deveOmitirSendMessage("operator_only")).toBe(true);
  });

  it("automatic mantém a ferramenta — é o modo que de fato atende", () => {
    expect(deveOmitirSendMessage("automatic")).toBe(false);
  });

  it("assisted mantém a ferramenta — o rascunho é gerado pelo mesmo Conversador", () => {
    expect(deveOmitirSendMessage("assisted")).toBe(false);
  });

  it("ausência de modo (undefined/null) NUNCA omite — silêncio não é o modo seguro aqui", () => {
    // Inverso do resto do motor de propósito: se um dia um bug apagar o valor
    // do banco, a leitura errada tem de cair do lado que MANTÉM a ferramenta
    // (comportamento de hoje, já em produção), não do lado que a tira de um
    // agente que ninguém configurou para ficar mudo.
    expect(deveOmitirSendMessage(undefined)).toBe(false);
    expect(deveOmitirSendMessage(null)).toBe(false);
  });
});

describe("o chamador honra a decisão", () => {
  const fonte = readFileSync(
    path.join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"),
    "utf8",
  );

  it("a remoção de send_message está DENTRO da decisão de deveOmitirSendMessage", () => {
    const i = fonte.indexOf("delete rawTools.send_message;");
    expect(
      i,
      "não achei a remoção de send_message — ENSINE ESTE TESTE (ela pode ter mudado de forma)",
    ).toBeGreaterThan(0);

    const antes = fonte.slice(Math.max(0, i - 300), i);
    expect(
      antes.includes("deveOmitirSendMessage("),
      "a remoção de send_message não está mais condicionada a deveOmitirSendMessage — " +
        "um refactor que preserva o texto 'delete rawTools.send_message' mas troca a " +
        "condição (ou remove a linha do if) reabre o vazamento sem este teste perceber.",
    ).toBe(true);
  });

  it("a remoção acontece ANTES do turno chamar o modelo — não é limpeza tardia", () => {
    // Uma versão que deletasse a tool DEPOIS de rawTools já ter sido copiado
    // para o ToolSet do runModelCall seria absoluta em código e inútil em
    // efeito: o modelo já teria recebido a ferramenta.
    const iDelete = fonte.indexOf("delete rawTools.send_message;");
    const iRunModelCall = fonte.indexOf("runModelCall(", iDelete);
    expect(iDelete).toBeGreaterThan(0);
    expect(
      iRunModelCall,
      "não achei uma chamada a runModelCall depois da remoção — confirme a ordem manualmente",
    ).toBeGreaterThan(iDelete);
  });
});
