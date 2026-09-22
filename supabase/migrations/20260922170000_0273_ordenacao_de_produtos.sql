-- 0273 — ordenação da lista de produtos.
--
-- Pedido do Anderson (2026-09-22): filtro de ordenar por nome A-Z, nome
-- Z-A, maior preço, menor preço em /app/products.
--
-- Acrescenta `p_ordenar_por` a `fn_listar_produtos_agrupados` (0271). O
-- critério de preço é POR GRUPO, não por variação: como a tela mostra um
-- card por grupo (a sanfona), "maior/menor preço" precisa de um preço
-- representativo do grupo inteiro — usamos o MENOR `preco_cents` entre as
-- variações (`preco_min_cents`), que é o preço que a pessoa veria primeiro
-- se abrisse o grupo.
--
-- `ativo_do_grupo desc` continua como critério PRIMÁRIO sempre, antes de
-- qualquer ordenação escolhida — é o que já existia (produto ativo antes de
-- inativo) e nenhuma ordenação pedida pelo Anderson tem a ver com isso; misturar
-- ativo e inativo no meio da lista ordenada por preço seria pior experiência,
-- não melhor.
--
-- `p_ordenar_por is null` ou valor não reconhecido → comportamento IDÊNTICO
-- ao de antes desta migration (nome A-Z), então nenhum chamador existente
-- quebra.
--
-- Idempotente.

create or replace function public.fn_listar_produtos_agrupados(
  p_organization_id uuid,
  p_estoque text,
  p_limite int,
  p_offset int,
  p_ordenar_por text default null
)
returns table (
  chave_grupo text,
  titulo text,
  ativo_do_grupo boolean,
  variacoes jsonb,
  preco_min_cents bigint,
  total_grupos bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtrado as (
    select
      a.id, a.codigo, a.nome, a.descricao, a.marca, a.categoria,
      a.preco_cents, a.preco_original_cents, a.moeda, a.custo_cents,
      a.controla_estoque, a.quantidade, a.ativo, a.origem, a.imagem_url,
      a.url_produto, a.updated_at,
      regexp_replace(
        regexp_replace(upper(a.codigo), '-([0-9]+|[A-Z]{1,4})$', ''),
        '0+([0-9])', '\1', 'g'
      ) as chave_grupo,
      regexp_replace(
        regexp_replace(
          a.nome,
          '((\s+([0-9]+|[A-Z]{1,4}))*\s*-\s*([0-9]+|[A-Z]{1,4})|\s*Tamanho:\s*([0-9]+|[A-Z]{1,4}))\s*$',
          ''
        ),
        '^\s+|\s+$', '', 'g'
      ) as titulo_limpo
    from public.catalog_products a
    where a.organization_id = p_organization_id
      and (
        p_estoque is null
        or (p_estoque = 'disponivel' and a.quantidade > 1)
        or (p_estoque = 'esgotado' and a.quantidade = 0)
      )
  ),
  agrupado as (
    select
      f.chave_grupo,
      (array_agg(f.titulo_limpo order by length(f.titulo_limpo) asc))[1] as titulo,
      bool_or(f.ativo) as ativo_do_grupo,
      min(f.preco_cents) as preco_min_cents,
      jsonb_agg(
        jsonb_build_object(
          'id', f.id, 'codigo', f.codigo, 'nome', f.nome, 'descricao', f.descricao,
          'marca', f.marca, 'categoria', f.categoria, 'preco_cents', f.preco_cents,
          'preco_original_cents', f.preco_original_cents, 'moeda', f.moeda,
          'custo_cents', f.custo_cents, 'controla_estoque', f.controla_estoque,
          'quantidade', f.quantidade, 'ativo', f.ativo, 'origem', f.origem,
          'imagem_url', f.imagem_url, 'url_produto', f.url_produto, 'updated_at', f.updated_at
        )
        order by f.nome
      ) as variacoes
    from filtrado f
    group by f.chave_grupo
  )
  select
    a.chave_grupo, a.titulo, a.ativo_do_grupo, a.variacoes, a.preco_min_cents,
    count(*) over() as total_grupos
  from agrupado a
  order by
    a.ativo_do_grupo desc,
    case when p_ordenar_por = 'nome_desc' then a.titulo end desc,
    case when p_ordenar_por = 'preco_asc' then a.preco_min_cents end asc,
    case when p_ordenar_por = 'preco_desc' then a.preco_min_cents end desc,
    a.titulo asc
  limit p_limite offset p_offset;
$$;

revoke all on function public.fn_listar_produtos_agrupados(uuid, text, int, int, text) from public, anon;
grant execute on function public.fn_listar_produtos_agrupados(uuid, text, int, int, text) to authenticated, service_role;

-- A assinatura ANTERIOR (sem `p_ordenar_por`) precisa sumir: com `create or
-- replace` e um parâmetro DEFAULT, o Postgres cria uma SEGUNDA função
-- (overload) em vez de substituir a antiga, porque a lista de parâmetros
-- posicionais é diferente. Duas funções com o mesmo nome e comportamento
-- redundante é o tipo de ambiguidade que quebra `supabase.rpc()` (o cliente
-- não sabe qual escolher) — medido no padrão idêntico das migrations de
-- catálogo anteriores desta base.
drop function if exists public.fn_listar_produtos_agrupados(uuid, text, int, int);
