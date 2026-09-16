import { describe, expect, it } from "vitest";

import { baseUrlFor, ehVendavel, normalizarSubdominio } from "@/lib/shoppub/config";

describe("baseUrlFor", () => {
  it("monta a URL sobre o subdomínio da loja", () => {
    expect(baseUrlFor("outlet360")).toBe("https://outlet360.shoppub.com.br/api/v1");
  });
});

describe("normalizarSubdominio", () => {
  it("aceita o subdomínio já limpo", () => {
    expect(normalizarSubdominio("outlet360")).toBe("outlet360");
  });

  it("extrai de uma URL completa colada por engano", () => {
    expect(normalizarSubdominio("https://outlet360.shoppub.com.br/admin")).toBe("outlet360");
  });

  it("extrai de um host sem protocolo", () => {
    expect(normalizarSubdominio("outlet360.shoppub.com.br")).toBe("outlet360");
  });

  it("aceita hífen no meio", () => {
    expect(normalizarSubdominio("minha-loja")).toBe("minha-loja");
  });

  it("devolve null pra vazio", () => {
    expect(normalizarSubdominio("")).toBeNull();
    expect(normalizarSubdominio("   ")).toBeNull();
  });

  it("devolve null pra caractere que não forma subdomínio válido", () => {
    expect(normalizarSubdominio("loja com espaço")).toBeNull();
  });

  it("corta no primeiro '/' — trata como host+path, não como rótulo literal", () => {
    expect(normalizarSubdominio("loja/errada")).toBe("loja");
  });
});

describe("ehVendavel", () => {
  it("produto normal (sem is_wrapper, sem extra_fields) é vendável", () => {
    expect(ehVendavel({})).toBe(true);
  });

  it("produto PAI (is_wrapper) NÃO é vendável — mesmo conceito do tipoVariacao P da Tiny", () => {
    expect(ehVendavel({ is_wrapper: true })).toBe(false);
  });

  it("produto marcado explicitamente como não vendável não é vendável, mesmo sem is_wrapper", () => {
    expect(ehVendavel({ is_wrapper: false, extra_fields: { produto_vendavel: false } })).toBe(false);
  });

  it("variação normal (is_wrapper false, produto_vendavel ausente ou true) é vendável", () => {
    expect(ehVendavel({ is_wrapper: false })).toBe(true);
    expect(ehVendavel({ is_wrapper: false, extra_fields: { produto_vendavel: true } })).toBe(true);
  });
});
