/**
 * Config da integração Shoppub.
 *
 * Diferente da Tiny (OAuth2, um "app" só por instalação, client_id/secret em
 * `.env`), a Shoppub não tem conceito de app: o token é da LOJA — por
 * tenant, não compartilhado. Não existe env var pra configurar; a credencial
 * inteira mora criptografada em `tenant_integrations` (mesma coluna
 * `oauth_access_token_encrypted` que os outros providers usam pro próprio
 * token, ainda que aqui não seja OAuth de verdade).
 *
 * Documentação oficial: https://shoppub.readme.io/reference/introducao-intro
 */

export function baseUrlFor(host: string): string {
  return `https://${host}/api/v1`;
}

/**
 * Normaliza o que o operador cola pra um HOST completo — não só o rótulo
 * antes do primeiro ponto.
 *
 * ⚠️ Essa era a versão anterior desta função, e o bug era real: ela pegava
 * SÓ o primeiro rótulo (`host.split(".")[0]`), assumindo que toda loja usa o
 * padrão `<slug>.shoppub.com.br`. Medido em produção — o Anderson colou
 * `www.outlet360.com.br` (o domínio PRÓPRIO da loja, não o subdomínio da
 * Shoppub) e a função devolveu `"www"`, que virou `https://www.shoppub.com.br/
 * api/v1` — host que não existe, e o teste da credencial falhou sem dizer o
 * motivo real (nem chegou a bater 401, foi antes disso).
 *
 * Muita loja usa domínio PRÓPRIO na frente da Shoppub, não o subdomínio
 * padrão — e não há como distinguir os dois só olhando o texto. A regra que
 * resolve os dois casos sem ambiguidade: rótulo ÚNICO, sem ponto nenhum
 * ("outlet360") só pode ser o slug padrão, então completa com
 * `.shoppub.com.br`; qualquer coisa com ponto (`outlet360.shoppub.com.br`,
 * `outlet360.com.br`, `www.outlet360.com.br`) já É um host de verdade — usa
 * como veio (só tira o `www.` de canto, colagem comum do navegador).
 */
export function normalizarSubdominio(entrada: string): string | null {
  let limpo = entrada.trim().toLowerCase();
  if (!limpo) return null;
  limpo = limpo.replace(/^https?:\/\//, "");
  limpo = limpo.split("/")[0] ?? "";
  limpo = limpo.replace(/^www\./, "");
  if (!limpo) return null;
  // Um rótulo (`outlet360`) OU vários separados por ponto (`outlet360.com.br`)
  // — o `*` no grupo do ponto cobre os dois formatos na mesma regra.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(limpo)) return null;
  return limpo.includes(".") ? limpo : `${limpo}.shoppub.com.br`;
}

interface ExtraFields {
  produto_vendavel?: boolean;
}

/**
 * Produto PAI (agrupador de variações — "is_wrapper") não é vendável, mesmo
 * conceito do `tipoVariacao === "P"` da Tiny: sem estoque próprio, não deve
 * entrar no catálogo que a IA usa pra responder preço/disponibilidade.
 * `extra_fields.produto_vendavel` é o segundo sinal — visto `false` no
 * mesmo exemplo de produto wrapper na documentação oficial.
 */
export function ehVendavel(p: { is_wrapper?: boolean; extra_fields?: ExtraFields | null }): boolean {
  if (p.is_wrapper) return false;
  if (p.extra_fields?.produto_vendavel === false) return false;
  return true;
}
