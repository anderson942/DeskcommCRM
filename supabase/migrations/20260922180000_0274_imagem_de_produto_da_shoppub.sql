-- 0274 — imagem de produto da Shoppub.
--
-- Pedido do Anderson (2026-09-22), depois de ver a sanfona de produtos com a
-- nova miniatura na sombra: a listagem/detalhe de produto da Shoppub
-- (`GET /produtos/`, `GET /produto/{sku}/`) NÃO traz imagem nenhuma —
-- confirmado contra a documentação oficial (2026-09-22,
-- https://shoppub.readme.io/reference/obter-produtos). Imagem é um serviço À
-- PARTE (`GET /produto-imagens/{sku}/`), uma chamada POR PRODUTO, sem
-- endpoint em lote — por isso `catalog_products.imagem_url` (0266, já
-- existia pra outros providers) está NULL nos 34 mil produtos de origem
-- Shoppub desta organização.
--
-- `imagem_checada_em` — por que existe, e por que não basta olhar
-- `imagem_url is null`: produto que genuinamente NÃO TEM foto cadastrada na
-- Shoppub (a API responde uma lista vazia, não erro) teria `imagem_url`
-- eternamente NULL — e um backfill que decide "o que falta buscar" olhando
-- só `imagem_url is null` reconsultaria ESSE MESMO produto pra sempre, sem
-- nunca convergir, gastando fatia do limite de 120 req/min compartilhado da
-- conta Shoppub à toa a cada rodada. A coluna nova marca "já perguntei pra
-- Shoppub, seja qual foi a resposta" — `imagem_checada_em` preenchido e
-- `imagem_url` ainda NULL é um resultado VÁLIDO (produto sem foto mesmo),
-- diferente de "ainda não perguntei". Falha de rede/API (não resposta
-- válida) não marca esta coluna — só sucesso de consulta marca, com foto ou
-- sem.
--
-- Idempotente.

alter table public.catalog_products
  add column if not exists imagem_checada_em timestamptz;

comment on column public.catalog_products.imagem_checada_em is
  'Quando a API de imagens do provider (hoje só Shoppub) foi consultada com sucesso pra este produto — preenchido mesmo quando a resposta foi "sem foto". NULL = nunca consultado (candidato ao backfill de imagem).';
