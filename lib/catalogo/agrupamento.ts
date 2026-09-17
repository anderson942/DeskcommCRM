/**
 * SANFONA DE VARIAÇÕES — agrupar produtos que são o MESMO item em tamanhos
 * diferentes numa única linha expansível, em vez de uma linha por SKU.
 *
 * Pedido do Anderson (2026-09-17), depois de ver a lista de produtos cheia
 * de "Calça VersatiOld ... Cinza 38 - 38", "Calça VersatiOld ... Cinza 38 40
 * - 40", "Calça VersatiOld ... Cinza 38 40 42 - 42"… — cada linha é uma
 * variação de tamanho da MESMA calça, não um produto diferente.
 *
 * A CHAVE do grupo é o CÓDIGO (prefixo antes do último "-NN"), não o nome:
 * o nome da Shoppub vai ACUMULANDO os tamanhos conforme sincroniza (mesmo
 * comportamento já documentado em `produtos-popup-de-detalhe.test.tsx`),
 * então duas linhas do mesmo grupo quase nunca têm o nome idêntico — só o
 * código é estável entre variações.
 */

export interface ProdutoAgrupavel {
  id: string;
  codigo: string;
  nome: string;
  ativo: boolean;
}

export interface GrupoDeProdutos<T> {
  /** Prefixo do código, comum a todas as variações — chave estável de React/UI. */
  chave: string;
  /** Nome sem a cauda de tamanhos — o que aparece fechado, antes de abrir a sanfona. */
  titulo: string;
  /** Verdadeiro se QUALQUER variação estiver ativa — decide o estilo da linha fechada. */
  ativo: boolean;
  variacoes: T[];
}

/**
 * Um "token de tamanho": número ("38", "40") OU letra de grade (P, M, G, GG,
 * XXL — até 4 maiúsculas). Confirmado contra o catálogo real da Outlet360
 * (2026-09-17): calças/bermudas usam número, mas camisas e linho da própria
 * VersatiOld usam letra — "Calça Linho VersatiOld Areia G GG M P XXL - XXL"
 * segue o MESMO padrão de acúmulo, só que com letra em vez de número.
 */
const TOKEN_DE_TAMANHO = "(?:\\d+|[A-Z]{1,4})";

/** "VOLD000000425-38" → "VOLD000000425"; "VOLD000000411-GG" → "VOLD000000411". Sem sufixo, o código inteiro é a chave — vira um grupo de 1. */
const SUFIXO_DE_TAMANHO_NO_CODIGO = new RegExp(`-${TOKEN_DE_TAMANHO}$`);

/**
 * A cauda de tamanho no NOME tem duas convenções reais no catálogo da
 * Outlet360 (confirmado contra produção, 2026-09-17):
 *
 *   1. Lista acumulada + traço: "...Cinza 38 40 42 - 42" (Shoppub, calças) —
 *      o `*` aceita ZERO tokens antes do traço de propósito: muita variação
 *      (Acostamento, Tommy Jeans) nunca acumula, é sempre só "- G" direto.
 *   2. "Tamanho:" dois pontos: "...Bege Tamanho:44" (Calvin Klein, Diesel,
 *      Ralph Lauren, Tommy — marcas premium, convenção de sync diferente).
 */
const CAUDA_DE_TAMANHOS_NO_NOME = new RegExp(
  `(?:(?:\\s+${TOKEN_DE_TAMANHO})*\\s*-\\s*${TOKEN_DE_TAMANHO}|\\s*Tamanho:\\s*${TOKEN_DE_TAMANHO})\\s*$`,
);

/** "...Cinza 38 - 38" / "...Bege Tamanho:44" → "38" / "44". O tamanho DESTA variação específica, nas duas convenções. */
const TAMANHO_NO_FIM_DO_NOME = new RegExp(
  `(?:-\\s*(${TOKEN_DE_TAMANHO})|Tamanho:\\s*(${TOKEN_DE_TAMANHO}))\\s*$`,
);

/**
 * Achado do Anderson (2026-09-17): "ACOS00000077-38" e "acos00000077-38"
 * (mesma variação, só a caixa do código difere) e "ACOS00000077-48" vs
 * "ACOS0000077-48" (mesmo produto, um zero a menos no meio) apareciam como
 * "duplicados" — na verdade eram o MESMO grupo que a chave não reconhecia
 * como igual. Normaliza os dois: maiúscula sempre, e zero à esquerda de
 * qualquer corrida de dígitos não conta (ID sequencial de sync, não parte
 * do nome do produto — "00000077" e "0000077" são o número 77 dos dois
 * jeitos). Verificado contra produção: pelo menos 20 famílias de produto
 * tinham esse mesmo problema de zero-padding, não só este uma vez.
 */
export function chaveDoGrupo(codigo: string): string {
  return codigo
    .toUpperCase()
    .replace(SUFIXO_DE_TAMANHO_NO_CODIGO, "")
    .replace(/0+(\d)/g, "$1");
}

export function tituloLimpo(nome: string): string {
  return nome.replace(CAUDA_DE_TAMANHOS_NO_NOME, "").trim();
}

/** Rótulo de uma variação já aberta na sanfona: "{título} - {tamanho}", com o nome cru como fallback. */
export function rotuloDaVariacao(variacao: { nome: string }, titulo: string): string {
  const achado = TAMANHO_NO_FIM_DO_NOME.exec(variacao.nome);
  const tamanho = achado?.[1] ?? achado?.[2];
  return tamanho !== undefined ? `${titulo} - ${tamanho}` : variacao.nome;
}

/**
 * Agrupa preservando a ordem de primeira aparição de cada chave — importante
 * para quem já chega RANQUEADO (busca) não perder a ordem de relevância.
 */
export function agruparProdutos<T extends ProdutoAgrupavel>(
  produtos: readonly T[],
): GrupoDeProdutos<T>[] {
  const porChave = new Map<string, T[]>();
  for (const p of produtos) {
    const chave = chaveDoGrupo(p.codigo);
    const lista = porChave.get(chave);
    if (lista) lista.push(p);
    else porChave.set(chave, [p]);
  }
  return Array.from(porChave.entries()).map(([chave, variacoes]) => ({
    chave,
    // O título mais curto entre as variações minimiza o risco de sobrar
    // resíduo de tamanho quando algum SKU do grupo foge do padrão esperado.
    titulo: variacoes
      .map((v) => tituloLimpo(v.nome))
      .reduce((menor, atual) => (atual.length < menor.length ? atual : menor)),
    ativo: variacoes.some((v) => v.ativo),
    variacoes: [...variacoes].sort((a, b) => a.nome.localeCompare(b.nome)),
  }));
}
