-- Suporte SQL pro fix de bw-sync/index.ts (2026-08-09, mesma sessão):
-- usuário reportou "na tabela [Autores e comunidades por pauta] só
-- aparece sentimento para um author, pq não aparece para os demais?"
--
-- Causa raiz confirmada lendo `get_authors_ranking`/`runAuthorEnrichmentStep`
-- lado a lado: sentimento por autor (`AuthorRow.sentiment_positive/neutral/
-- negative`) só existe pra autores já enriquecidos via
-- `bw_query_author_topics` — mas `runAuthorEnrichmentStep` só enriquece os
-- top 10 autores por volume da QUERY INTEIRA (`bw_query_top_authors` com
-- `category_id is null`), nunca escopado por Narrativa/Pauta. Como Pautas é
-- normalmente um subconjunto pequeno do que a Query inteira rastreia (mesma
-- observação já confirmada pelo bug de SOV corrigido antes nesta sessão), o
-- conjunto "top 10 autores da Query inteira" e "autores ativos em Pautas"
-- são majoritariamente disjuntos — só quando um autor aparece nos dois
-- (por coincidência) é que a tabela de Pautas mostra sentimento pra ele,
-- exatamente o "só aparece para um" relatado.
--
-- Fix: esta function resolve os top N autores por volume DENTRO do escopo
-- de Pautas (soma de `bw_query_top_authors.volume` entre todas as
-- Subcategories ativas de "Pautas", agrupado por autor) — `bw-sync` usa o
-- resultado como um segundo pool de candidatos a enriquecer (além do pool
-- global já existente), ver `runAuthorEnrichmentStep` em `bw-sync/index.ts`.

create or replace function bw_pautas_top_author_candidates(
  p_organization_id uuid,
  p_project_id bigint,
  p_query_id bigint,
  p_limit integer default 10
)
returns table (author text)
language sql
stable
set search_path = public
as $$
  with pauta_category_ids as (
    select bc.id
    from bw_categories bc
    where bc.parent_id = pautas_root_category_id(p_organization_id)
      and bc.status = 'active'
  ),
  latest_week as (
    select max(t.metric_week) as w
    from bw_query_top_authors t
    where t.project_id = p_project_id
      and t.query_id = p_query_id
      and t.category_id in (select id from pauta_category_ids)
  ),
  ranked as (
    select t.author, sum(t.volume) as total_volume
    from bw_query_top_authors t
    where t.project_id = p_project_id
      and t.query_id = p_query_id
      and t.category_id in (select id from pauta_category_ids)
      and t.metric_week = (select w from latest_week)
    group by t.author
  )
  select author from ranked order by total_volume desc limit p_limit
$$;

comment on function bw_pautas_top_author_candidates(uuid, bigint, bigint, integer) is
  'Top N autores por volume somado entre todas as Subcategories ativas de "Pautas" (pautas_root_category_id), da semana mais recente sincronizada em bw_query_top_authors para esse escopo. Usado por bw-sync/runAuthorEnrichmentStep como um segundo pool de candidatos a enriquecer via bw_query_author_topics (além do pool global de top 10 da Query inteira já existente) — sem isso, sentimento por autor só aparecia pra quem coincidentemente estivesse nos dois pools.';
