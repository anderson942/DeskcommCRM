-- 0270 — fn_buscar_produtos_candidatos: rede larga pra busca inteligente
-- de produtos na tela (/app/products).
--
-- Pedido do Anderson (2026-09-17): a busca da tela hoje é substring da FRASE
-- INTEIRA (`nome.ilike.%busca%`) — "camiseta tom" só acha "Camiseta Tommy..."
-- por coincidência de prefixo, e não tolera nem ordem trocada ("tom camiseta")
-- nem erro de digitação. Já existe um motor de ranqueamento calibrado pra
-- isso — `lib/catalogo/busca.ts`, usado hoje só pelo agente de IA — mas ele
-- roda em memória (JS), e carregar os ~31 mil produtos da Outlet360 a cada
-- tecla digitada não escala.
--
-- Esta função é só a REDE LARGA: usa o índice `catalog_products_nome_trgm`
-- (pg_trgm, já existia — nunca tinha sido usado por nada) pra achar
-- candidatos rápido, tolerando erro de digitação via similaridade de
-- trigrama, mais ILIKE por PALAVRA (não a frase inteira) pra casar em
-- qualquer ordem. A PRECISÃO final — número é filtro exato, palavra é
-- aproximada, prefixo pesa mais que distância de edição — continua sendo
-- decidida pelo `lib/catalogo/busca.ts` de sempre, em cima do que esta
-- função devolve. SQL erra pro lado de trazer candidato demais; o TypeScript
-- já sabe descartar o que não serve.
--
-- Idempotente.

create or replace function public.fn_buscar_produtos_candidatos(
  p_organization_id uuid,
  p_busca text,
  p_palavras text[],
  p_estoque text,
  p_limite int
)
returns table (
  id uuid,
  codigo text,
  nome text,
  descricao text,
  marca text,
  categoria text,
  preco_cents bigint,
  preco_original_cents bigint,
  moeda text,
  custo_cents bigint,
  controla_estoque boolean,
  quantidade integer,
  ativo boolean,
  origem text,
  imagem_url text,
  url_produto text,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    a.id, a.codigo, a.nome, a.descricao, a.marca, a.categoria,
    a.preco_cents, a.preco_original_cents, a.moeda, a.custo_cents,
    a.controla_estoque, a.quantidade, a.ativo, a.origem, a.imagem_url,
    a.url_produto, a.updated_at
  from public.catalog_products a
  where a.organization_id = p_organization_id
    and (
      -- Frase inteira, como a busca de hoje — nada regride.
      a.nome ilike '%' || p_busca || '%'
      or a.codigo ilike '%' || p_busca || '%'
      or coalesce(a.marca, '') ilike '%' || p_busca || '%'
      -- Palavra a palavra, em qualquer ordem — "tom camiseta" também acha.
      or (
        p_palavras is not null and array_length(p_palavras, 1) > 0
        and exists (
          select 1 from unnest(p_palavras) w
          where a.nome ilike '%' || w || '%' or coalesce(a.marca, '') ilike '%' || w || '%'
        )
      )
      -- Trigrama — tolera erro de digitação ("camista" acha "camiseta").
      or a.nome % p_busca
    )
    and (
      p_estoque is null
      or (p_estoque = 'disponivel' and a.quantidade > 1)
      or (p_estoque = 'esgotado' and a.quantidade = 0)
    )
  order by similarity(a.nome, p_busca) desc, a.ativo desc, a.nome
  limit p_limite;
$$;

revoke all on function public.fn_buscar_produtos_candidatos(uuid, text, text[], text, int) from public, anon;
grant execute on function public.fn_buscar_produtos_candidatos(uuid, text, text[], text, int) to authenticated, service_role;
