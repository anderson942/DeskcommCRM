import { describe, expect, it } from "vitest";

import { agruparProdutos, chaveDoGrupo, rotuloDaVariacao, tituloLimpo } from "./agrupamento";

/** As 7 linhas reais do print que o Anderson mandou (2026-09-17). */
const VARIACOES_DA_CALCA = [
  { id: "1", codigo: "VOLD000000425-38", nome: "Calça VersatiOld Alfaiataria Premium Slim Cinza 38 - 38", ativo: true },
  { id: "2", codigo: "VOLD000000425-40", nome: "Calça VersatiOld Alfaiataria Premium Slim Cinza 38 40 - 40", ativo: true },
  { id: "3", codigo: "VOLD000000425-42", nome: "Calça VersatiOld Alfaiataria Premium Slim Cinza 38 40 42 - 42", ativo: true },
  { id: "4", codigo: "VOLD000000425-44", nome: "Calça VersatiOld Alfaiataria Premium Slim Cinza 38 40 42 44 - 44", ativo: true },
  { id: "5", codigo: "VOLD000000425-46", nome: "Calça VersatiOld Alfaiataria Premium Slim Cinza 38 40 42 44 46 - 46", ativo: true },
  { id: "6", codigo: "VOLD000000425-48", nome: "Calça VersatiOld Alfaiataria Premium Slim Cinza 38 40 42 44 46 48 - 48", ativo: true },
  { id: "7", codigo: "VOLD000000425-50", nome: "Calça VersatiOld Alfaiataria Premium Slim Cinza 38 40 42 44 46 48 50 - 50", ativo: true },
];

/** Grade de LETRA real da Outlet360 (verificado contra produção, 2026-09-17) — mesmo padrão, mas P/M/G/GG/XXL em vez de número. */
const VARIACOES_DO_LINHO = [
  { id: "1", codigo: "VOLD000000411-G", nome: "Calça Linho VersatiOld Areia  G - G", ativo: true },
  { id: "2", codigo: "VOLD000000411-GG", nome: "Calça Linho VersatiOld Areia  G GG - GG", ativo: true },
  { id: "3", codigo: "VOLD000000411-M", nome: "Calça Linho VersatiOld Areia  G GG M - M", ativo: true },
  { id: "4", codigo: "VOLD000000411-P", nome: "Calça Linho VersatiOld Areia  G GG M P - P", ativo: true },
  { id: "5", codigo: "VOLD000000411-XXL", nome: "Calça Linho VersatiOld Areia  G GG M P XXL - XXL", ativo: true },
];

describe("chaveDoGrupo", () => {
  it("tira o sufixo de tamanho NUMÉRICO do código", () => {
    expect(chaveDoGrupo("VOLD000000425-38")).toBe("VOLD000000425");
    expect(chaveDoGrupo("VOLD000000425-50")).toBe("VOLD000000425");
  });

  /**
   * Achado verificando a 0271 contra o catálogo real da Outlet360
   * (2026-09-17): grade de LETRA (P, M, G, GG, XXL) segue o mesmo padrão de
   * sufixo — "VOLD000000411-G", "-GG", "-M", "-P", "-XXL" são a MESMA calça
   * de linho em tamanhos diferentes, não produtos distintos.
   */
  it("tira o sufixo de tamanho em LETRA do código (grade P/M/G/GG/XXL)", () => {
    expect(chaveDoGrupo("VOLD000000411-G")).toBe("VOLD000000411");
    expect(chaveDoGrupo("VOLD000000411-GG")).toBe("VOLD000000411");
    expect(chaveDoGrupo("VOLD000000411-XXL")).toBe("VOLD000000411");
  });

  it("código sem sufixo de tamanho vira a própria chave", () => {
    expect(chaveDoGrupo("BONE-RL-CLASSIC")).toBe("BONE-RL-CLASSIC");
    expect(chaveDoGrupo("IP15")).toBe("IP15");
  });
});

describe("tituloLimpo", () => {
  it("tira a cauda de tamanhos acumulados do nome, para as 7 variações reais", () => {
    for (const v of VARIACOES_DA_CALCA) {
      expect(tituloLimpo(v.nome)).toBe("Calça VersatiOld Alfaiataria Premium Slim Cinza");
    }
  });

  it("tira a cauda de tamanhos em LETRA (grade P/M/G/GG/XXL), com o espaço duplo real do dado de produção", () => {
    for (const v of VARIACOES_DO_LINHO) {
      expect(tituloLimpo(v.nome)).toBe("Calça Linho VersatiOld Areia");
    }
  });

  it("nome sem cauda de tamanho não muda", () => {
    expect(tituloLimpo("Boné Polo RL Classic Chumbo")).toBe("Boné Polo RL Classic Chumbo");
  });

  it("não estraga um nome cujo número faz parte da identidade do produto, não é sufixo '- NN'", () => {
    expect(tituloLimpo("Perfume 212 Masculino")).toBe("Perfume 212 Masculino");
    expect(tituloLimpo("iPhone 15 Pro 256GB")).toBe("iPhone 15 Pro 256GB");
  });

  it("não estraga um nome que termina em sigla maiúscula sem o padrão '- TOKEN' de cauda", () => {
    expect(tituloLimpo("Tênis Nike Air Force SB")).toBe("Tênis Nike Air Force SB");
  });

  /**
   * Achado verificando contra produção (2026-09-17): muita variação
   * (Acostamento, Tommy Jeans, Ralph Lauren) nunca chega a ACUMULAR uma
   * lista — é sempre só "- G" direto, sem tamanho nenhum antes do traço.
   */
  it("tira '- TOKEN' mesmo SEM lista acumulada antes do traço", () => {
    expect(tituloLimpo("Camiseta Tommy Jeans Badged Embroidery Preta - G")).toBe(
      "Camiseta Tommy Jeans Badged Embroidery Preta",
    );
  });

  /**
   * Achado verificando contra produção (2026-09-17): marcas premium
   * (Calvin Klein, Diesel, Ralph Lauren, Tommy) usam "Tamanho:NN" em vez da
   * lista acumulada — convenção de sync diferente, mesmo problema visual.
   */
  it("tira a cauda 'Tamanho:NN' (convenção das marcas premium)", () => {
    expect(tituloLimpo("Blazer Calvin Klein Slim Bege Tamanho:44")).toBe("Blazer Calvin Klein Slim Bege");
    expect(tituloLimpo("Camisa Ralph Lauren Lavender Tamanho:P")).toBe("Camisa Ralph Lauren Lavender");
  });
});

describe("rotuloDaVariacao", () => {
  it("monta 'título - tamanho' a partir do nome cru da variação", () => {
    const titulo = "Calça VersatiOld Alfaiataria Premium Slim Cinza";
    expect(rotuloDaVariacao(VARIACOES_DA_CALCA[0]!, titulo)).toBe(`${titulo} - 38`);
    expect(rotuloDaVariacao(VARIACOES_DA_CALCA[6]!, titulo)).toBe(`${titulo} - 50`);
  });

  it("monta 'título - tamanho' também pra grade de LETRA", () => {
    const titulo = "Calça Linho VersatiOld Areia";
    expect(rotuloDaVariacao(VARIACOES_DO_LINHO[0]!, titulo)).toBe(`${titulo} - G`);
    expect(rotuloDaVariacao(VARIACOES_DO_LINHO[4]!, titulo)).toBe(`${titulo} - XXL`);
  });

  it("monta 'título - tamanho' também pra convenção 'Tamanho:NN'", () => {
    expect(rotuloDaVariacao({ nome: "Blazer Calvin Klein Slim Bege Tamanho:44" }, "Blazer Calvin Klein Slim Bege")).toBe(
      "Blazer Calvin Klein Slim Bege - 44",
    );
  });

  it("nome sem o padrão '- NN' no fim cai no próprio nome, sem quebrar", () => {
    expect(rotuloDaVariacao({ nome: "Boné Polo RL Classic Chumbo" }, "Boné Polo RL Classic Chumbo")).toBe(
      "Boné Polo RL Classic Chumbo",
    );
  });
});

describe("agruparProdutos", () => {
  it("as 7 variações da calça viram 1 grupo com título limpo e as 7 dentro", () => {
    const grupos = agruparProdutos(VARIACOES_DA_CALCA);

    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.chave).toBe("VOLD000000425");
    expect(grupos[0]!.titulo).toBe("Calça VersatiOld Alfaiataria Premium Slim Cinza");
    expect(grupos[0]!.variacoes).toHaveLength(7);
  });

  it("as 5 variações de grade em LETRA (G/GG/M/P/XXL) viram 1 grupo, não 5 grupos de 1", () => {
    // O achado que motivou este teste: antes da correção, o sufixo de
    // código "-G"/"-GG"/"-M"/"-P"/"-XXL" não era reconhecido como tamanho
    // (só número era), e essas 5 linhas reais da Outlet360 apareciam como 5
    // produtos "diferentes" em vez de 1 sanfona.
    const grupos = agruparProdutos(VARIACOES_DO_LINHO);

    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.chave).toBe("VOLD000000411");
    expect(grupos[0]!.titulo).toBe("Calça Linho VersatiOld Areia");
    expect(grupos[0]!.variacoes).toHaveLength(5);
  });

  it("produto sem irmão de tamanho vira grupo de 1, sozinho", () => {
    const grupos = agruparProdutos([{ id: "1", codigo: "BONE-RL-01", nome: "Boné Polo RL Classic", ativo: true }]);

    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.variacoes).toHaveLength(1);
    expect(grupos[0]!.titulo).toBe("Boné Polo RL Classic");
  });

  it("dois produtos de códigos diferentes nunca se misturam no mesmo grupo", () => {
    const grupos = agruparProdutos([
      { id: "1", codigo: "BONE-RL-01", nome: "Boné Polo RL Classic Chumbo", ativo: true },
      { id: "2", codigo: "TENIS-40", nome: "Tênis Nike 40", ativo: true },
    ]);

    expect(grupos).toHaveLength(2);
    expect(grupos.map((g) => g.chave).sort()).toEqual(["BONE-RL", "TENIS"]);
  });

  it("grupo ativo se QUALQUER variação estiver ativa — não precisa ser todas", () => {
    const grupos = agruparProdutos([
      { ...VARIACOES_DA_CALCA[0]!, ativo: false },
      { ...VARIACOES_DA_CALCA[1]!, ativo: true },
    ]);

    expect(grupos[0]!.ativo).toBe(true);
  });

  it("grupo inativo só quando NENHUMA variação restou ativa", () => {
    const grupos = agruparProdutos([
      { ...VARIACOES_DA_CALCA[0]!, ativo: false },
      { ...VARIACOES_DA_CALCA[1]!, ativo: false },
    ]);

    expect(grupos[0]!.ativo).toBe(false);
  });

  it("preserva a ordem de PRIMEIRA aparição da chave — importante pra não perder o ranking da busca", () => {
    const grupos = agruparProdutos([
      { id: "z", codigo: "ZZZ-01", nome: "Zeta", ativo: true },
      { id: "a1", codigo: "AAA-01", nome: "Alfa 1", ativo: true },
      { id: "a2", codigo: "AAA-02", nome: "Alfa 2", ativo: true },
    ]);

    expect(grupos.map((g) => g.chave)).toEqual(["ZZZ", "AAA"]);
  });
});
