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

export function baseUrlFor(subdominio: string): string {
  return `https://${subdominio}.shoppub.com.br/api/v1`;
}

/**
 * Extrai o subdomínio de qualquer forma que o operador cole: já limpo
 * ("outlet360"), URL completa ("https://outlet360.shoppub.com.br/admin") ou
 * só o host. Falha fechado (`null`) — subdomínio errado aponta a integração
 * pra loja de outra pessoa, silenciosamente.
 */
export function normalizarSubdominio(entrada: string): string | null {
  const limpo = entrada.trim().toLowerCase();
  if (!limpo) return null;
  const semProtocolo = limpo.replace(/^https?:\/\//, "");
  const host = semProtocolo.split("/")[0] ?? "";
  const primeiroRotulo = host.split(".")[0] ?? "";
  if (!/^[a-z0-9-]{2,63}$/.test(primeiroRotulo)) return null;
  return primeiroRotulo;
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
