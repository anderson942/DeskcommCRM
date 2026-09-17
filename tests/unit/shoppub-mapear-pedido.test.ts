import { describe, expect, it } from "vitest";

import { mapearPedido } from "@/lib/shoppub/mapear-pedido";
import type { ShoppubPedido } from "@/lib/shoppub/api-client";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "22222222-2222-4222-8222-222222222222";

function pedido(over: Partial<ShoppubPedido> = {}): ShoppubPedido {
  return {
    id: 55123,
    status: 1,
    status_resumido: 1,
    data: "2026-09-17T10:00:00Z",
    data_pagamento: null,
    telefone1: null,
    celular: "(62) 99973-5261",
    valor_total: 259.9,
    ...over,
  };
}

describe("mapearPedido", () => {
  it("external_provider sempre 'shoppub', external_id é o id como texto", () => {
    const linha = mapearPedido(pedido({ id: 55123 }), ORG_ID, CONTACT_ID);
    expect(linha.external_provider).toBe("shoppub");
    expect(linha.external_id).toBe("55123");
    expect(linha.organization_id).toBe(ORG_ID);
  });

  it("contact_id vem de FORA — a função não resolve telefone, só usa o que recebe", () => {
    expect(mapearPedido(pedido(), ORG_ID, CONTACT_ID).contact_id).toBe(CONTACT_ID);
    expect(mapearPedido(pedido(), ORG_ID, null).contact_id).toBeNull();
  });

  /**
   * `status`/`status_resumido` não têm tabela de valores documentada.
   * `data_pagamento` presente é o único sinal confirmado contra pedido real
   * (2026-09-17) — por isso o mapeamento usa a PRESENÇA do campo, não o
   * código numérico.
   */
  it("status 'paid' quando há data_pagamento, 'pending' quando não há", () => {
    expect(mapearPedido(pedido({ data_pagamento: "2026-09-17T12:00:00Z" }), ORG_ID, CONTACT_ID).status).toBe("paid");
    expect(mapearPedido(pedido({ data_pagamento: null }), ORG_ID, CONTACT_ID).status).toBe("pending");
  });

  it("converte valor_total (número) pra centavos", () => {
    const linha = mapearPedido(pedido({ valor_total: 259.9 }), ORG_ID, CONTACT_ID);
    expect(linha.total_cents).toBe(25990);
  });

  it("converte valor_total (string decimal, como a Shoppub às vezes manda) pra centavos", () => {
    const linha = mapearPedido(pedido({ valor_total: "1234.56" }), ORG_ID, CONTACT_ID);
    expect(linha.total_cents).toBe(123456);
  });

  it("guarda os códigos brutos de status em payload, pra investigação futura sem perder o dado original", () => {
    const linha = mapearPedido(pedido({ status: 3, status_resumido: 2 }), ORG_ID, CONTACT_ID);
    expect(linha.payload).toEqual({ status_raw: 3, status_resumido_raw: 2 });
  });

  it("ordered_at espelha a data do pedido, currency é sempre BRL", () => {
    const linha = mapearPedido(pedido({ data: "2026-09-17T10:00:00Z" }), ORG_ID, CONTACT_ID);
    expect(linha.ordered_at).toBe("2026-09-17T10:00:00Z");
    expect(linha.currency).toBe("BRL");
  });
});
