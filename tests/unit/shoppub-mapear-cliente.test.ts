import { describe, expect, it } from "vitest";

import { mapearCliente } from "@/lib/shoppub/mapear-cliente";
import type { ShoppubCliente } from "@/lib/shoppub/api-client";

const ORG_ID = "11111111-1111-4111-8111-111111111111";

function cliente(over: Partial<ShoppubCliente> = {}): ShoppubCliente {
  return {
    id: 8842,
    nome: "Maria Souza",
    email: "maria@example.com",
    telefone1: null,
    celular: null,
    bloqueado: false,
    total_gasto: null,
    quantidade_pedidos: null,
    quantidade_pedidos_pagos: null,
    ticket_medio: null,
    data_ultimo_pedido: null,
    ...over,
  };
}

describe("mapearCliente", () => {
  it("origem sempre 'shoppub', external_id é o id como texto", () => {
    const linha = mapearCliente(cliente({ id: 8842 }), ORG_ID);
    expect(linha.origem).toBe("shoppub");
    expect(linha.external_id).toBe("8842");
    expect(linha.organization_id).toBe(ORG_ID);
  });

  it("prefere celular sobre telefone1 quando os dois existem", () => {
    const linha = mapearCliente(cliente({ celular: "(62) 99973-5261", telefone1: "(62) 3251-0000" }), ORG_ID);
    expect(linha.telefone_e164).toBe("+5562999735261");
  });

  it("cai pra telefone1 quando não há celular", () => {
    const linha = mapearCliente(cliente({ celular: null, telefone1: "(62) 99973-5261" }), ORG_ID);
    expect(linha.telefone_e164).toBe("+5562999735261");
  });

  it("telefone_e164 fica null quando a Shoppub não manda telefone nenhum", () => {
    const linha = mapearCliente(cliente({ celular: null, telefone1: null }), ORG_ID);
    expect(linha.telefone_e164).toBeNull();
  });

  it("converte total_gasto e ticket_medio (string decimal da Shoppub) pra centavos", () => {
    const linha = mapearCliente(cliente({ total_gasto: "1234.56", ticket_medio: "308.64" }), ORG_ID);
    expect(linha.total_gasto_cents).toBe(123456);
    expect(linha.ticket_medio_cents).toBe(30864);
  });

  it("valores monetários ficam null quando a Shoppub não informa", () => {
    const linha = mapearCliente(cliente({ total_gasto: null, ticket_medio: null }), ORG_ID);
    expect(linha.total_gasto_cents).toBeNull();
    expect(linha.ticket_medio_cents).toBeNull();
  });

  it("nome e email ficam null quando vazios, em vez de string vazia", () => {
    const linha = mapearCliente(cliente({ nome: "", email: "" }), ORG_ID);
    expect(linha.nome).toBeNull();
    expect(linha.email).toBeNull();
  });

  it("bloqueado espelha o campo da Shoppub", () => {
    expect(mapearCliente(cliente({ bloqueado: true }), ORG_ID).bloqueado).toBe(true);
    expect(mapearCliente(cliente({ bloqueado: false }), ORG_ID).bloqueado).toBe(false);
  });
});
