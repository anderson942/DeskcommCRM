import { describe, expect, it } from "vitest";

import { baseUrlFor, ehVendavel, normalizarSubdominio } from "@/lib/shoppub/config";

describe("baseUrlFor", () => {
  it("monta a URL sobre o host completo da loja", () => {
    expect(baseUrlFor("outlet360.shoppub.com.br")).toBe("https://outlet360.shoppub.com.br/api/v1");
  });

  it("funciona igual com domínio próprio", () => {
    expect(baseUrlFor("outlet360.com.br")).toBe("https://outlet360.com.br/api/v1");
  });
});

describe("normalizarSubdominio", () => {
  it("um rótulo sozinho ('outlet360') é o slug padrão — completa com .shoppub.com.br", () => {
    expect(normalizarSubdominio("outlet360")).toBe("outlet360.shoppub.com.br");
  });

  it("host completo do subdomínio Shoppub passa intacto", () => {
    expect(normalizarSubdominio("outlet360.shoppub.com.br")).toBe("outlet360.shoppub.com.br");
  });

  /**
   * O BUG REAL (2026-09-16): a versão anterior só olhava o primeiro rótulo
   * antes do ponto — "www.outlet360.com.br" virava "www", host que não
   * existe. Muita loja usa DOMÍNIO PRÓPRIO na frente da Shoppub, não o
   * subdomínio padrão, e a função precisa aceitar os dois sem ambiguidade.
   */
  it("domínio PRÓPRIO da loja (não .shoppub.com.br) passa intacto, sem cortar no primeiro ponto", () => {
    expect(normalizarSubdominio("outlet360.com.br")).toBe("outlet360.com.br");
  });

  it("tira o 'www.' de colagem comum do navegador, domínio próprio ou não", () => {
    expect(normalizarSubdominio("www.outlet360.com.br")).toBe("outlet360.com.br");
    expect(normalizarSubdominio("https://www.outlet360.com.br/admin")).toBe("outlet360.com.br");
  });

  it("extrai de uma URL completa colada por engano", () => {
    expect(normalizarSubdominio("https://outlet360.shoppub.com.br/admin")).toBe("outlet360.shoppub.com.br");
  });

  it("aceita hífen no meio", () => {
    expect(normalizarSubdominio("minha-loja")).toBe("minha-loja.shoppub.com.br");
  });

  it("devolve null pra vazio", () => {
    expect(normalizarSubdominio("")).toBeNull();
    expect(normalizarSubdominio("   ")).toBeNull();
  });

  it("devolve null pra caractere que não forma host válido", () => {
    expect(normalizarSubdominio("loja com espaço")).toBeNull();
  });

  it("corta no primeiro '/' — trata como host+path, não como rótulo literal", () => {
    expect(normalizarSubdominio("loja/errada")).toBe("loja.shoppub.com.br");
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
