-- 0271 — sanfona de variações de tamanho na lista de produtos.
--
-- Pedido do Anderson (2026-09-17): a lista de /app/products mostra cada
-- tamanho da Shoppub como produto separado ("Calça ... 38 - 38", "Calça ...
-- 38 40 - 40", "Calça ... 38 40 42 - 42"…) — a mesma calça repetida N
-- vezes. A tela passa a agrupar num acordeão: um título limpo ("Calça
-- VersatiOld Alfaiataria Premium Slim Cinza") que expande pras variações de
-- tamanho, cada uma com seu preço, abrindo o MESMO popup de detalhe que já
-- existe.
--
-- A CHAVE do grupo é o CÓDIGO (prefixo antes do último sufixo de tamanho —
-- número OU letra de grade: "-38", "-GG"), não o nome — o nome da Shoppub
-- ACUMULA os tamanhos conforme sincroniza (documentado em
-- `produtos-popup-de-detalhe.test.tsx`), então duas variações do mesmo
-- grupo quase nunca têm nome idêntico; o código é o que é estável.
--
-- Esta função cobre o caminho SEM busca (`busca=""`): agrupa, ordena por
-- ativo/título e pagina DIRETO NO BANCO — evita carregar as ~31 mil linhas
-- da Outlet360 em memória a cada troca de página. O caminho COM busca
-- continua usando `fn_buscar_produtos_candidatos` (0270) como rede larga; o
-- agrupamento e o ranqueamento por título, nesse caminho, acontecem em
-- TypeScript (`lib/catalogo/agrupamento.ts` + `lib/catalogo/busca.ts`) — a
-- MESMA lógica de chave/título, calculada duas vezes por linguagens
-- diferentes, de propósito: SQL pagina a listagem, JS reordena o que a
-- busca já trouxe.
--
-- Idempotente.

create or replace function public.fn_listar_produtos_agrupados(
  p_organization_id uuid,
  p_estoque text,
  p_limite int,
  p_offset int
)
returns table (
  chave_grupo text,
  titulo text,
  ativo_do_grupo boolean,
  variacoes jsonb,
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
      -- Token de tamanho: número ("38") OU letra de grade (P, M, G, GG,
      -- XXL — até 4 maiúsculas). Mesma regra de `lib/catalogo/agrupamento.ts`
      -- — confirmado contra o catálogo real: calça usa número, linho da
      -- mesma VersatiOld usa letra, e é o MESMO padrão de acúmulo nos dois.
      regexp_replace(a.codigo, '-([0-9]+|[A-Z]{1,4})$', '') as chave_grupo,
      -- Duas convenções reais de cauda no NOME (confirmado contra produção,
      -- 2026-09-17): (1) lista acumulada + traço — "* " aceita ZERO tokens
      -- antes do traço de propósito, muita variação (Acostamento, Tommy
      -- Jeans) nunca acumula, é sempre só "- G" direto; (2) "Tamanho:NN" das
      -- marcas premium (Calvin Klein, Diesel, Ralph Lauren, Tommy).
      -- `trim()` sozinho só tira ESPAÇO — não tira tab, e um nome real da
      -- Outlet360 tem tab embutido antes do título. `'^\s+|\s+$'` cobre
      -- qualquer espaço em branco nas duas pontas, não só o caractere ' '.
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
      -- O título mais curto entre as variações minimiza o risco de sobrar
      -- resíduo de tamanho quando algum SKU foge do padrão esperado.
      (array_agg(f.titulo_limpo order by length(f.titulo_limpo) asc))[1] as titulo,
      bool_or(f.ativo) as ativo_do_grupo,
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
    a.chave_grupo, a.titulo, a.ativo_do_grupo, a.variacoes,
    count(*) over() as total_grupos
  from agrupado a
  order by a.ativo_do_grupo desc, a.titulo
  limit p_limite offset p_offset;
$$;

revoke all on function public.fn_listar_produtos_agrupados(uuid, text, int, int) from public, anon;
grant execute on function public.fn_listar_produtos_agrupados(uuid, text, int, int) to authenticated, service_role;
