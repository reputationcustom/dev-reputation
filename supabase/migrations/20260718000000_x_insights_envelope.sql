-- Fecha um gap real encontrado numa auditoria pedida pelo usuário: "Top
-- Hashtags", "Most Mentioned X Posters", "Top Stories" e "Top Emojis" são
-- visualizações nativas da Brandwatch (dashboard "X Themes") que a
-- foundation já captura corretamente desde 2026-07-11
-- (bw_query_x_insights, migration 20260711070000 — 4 endpoints de
-- "X (Twitter) Insights": data/hashtags, data/emoticons, data/urls
-- ("Stories"), data/mentionedauthors), mas que nenhuma function/bloco de
-- aggregated-metrics jamais expôs — dado sincronizado e parado, sem
-- nenhum consumidor a jusante (nem SQL, nem envelope, nem frontend). Já
-- estava sinalizado como "oportunidade futura, não desenhada ainda" em
-- intelligence-center/platform-analysis.md (2026-07-13) — esta migration
-- implementa o que lá estava só planejado.

-- =========================================================================
-- get_x_insights — novo bloco `x_insights` do envelope (só na página
-- `platforms`, ver block-mapping-per-page.md). Devolve até 10 itens por
-- `insight_type` (hashtag/emoticon/url/mentioned_author), ordenados por
-- volume desc, da semana mais recente já sincronizada POR TIPO (mesmo
-- "snapshot mais recente" de get_term_signals — metric_week é um marcador
-- de frescor, não um bucket de calendário real, por isso p_period_start/
-- p_period_end não filtram linhas, só mantidos na assinatura por
-- consistência de interface).
-- =========================================================================

create or replace function get_x_insights(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  insight_type text,
  name text,
  label text,
  volume integer,
  tweets integer,
  retweets integer,
  impressions bigint,
  reach_estimate bigint
)
language sql
stable
as $$
  with cat_ids as (
    select filter_category_ids(p_organization_id, p_filters) as ids
  ),
  scoped as (
    select xi.*
    from bw_query_x_insights xi
    cross join cat_ids
    where xi.query_id in (select org_query_ids(p_organization_id))
      and (
        (cat_ids.ids is null and xi.category_id is null)
        or xi.category_id = any(cat_ids.ids)
      )
  ),
  latest as (
    select insight_type, max(metric_week) as w
    from scoped
    group by insight_type
  ),
  ranked as (
    select
      s.insight_type,
      s.name,
      s.label,
      s.volume,
      s.tweets,
      s.retweets,
      s.impressions,
      s.reach_estimate,
      row_number() over (partition by s.insight_type order by s.volume desc) as rn
    from scoped s
    join latest l on l.insight_type = s.insight_type and l.w = s.metric_week
  )
  select insight_type, name, label, volume, tweets, retweets, impressions, reach_estimate
  from ranked
  where rn <= 10
  order by insight_type, volume desc
$$;
