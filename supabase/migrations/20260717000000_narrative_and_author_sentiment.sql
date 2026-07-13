-- Fecha 2 gaps reais encontrados numa auditoria de "sentimento por
-- plataforma/narrativa/autores/termos" (2026-07-17, pedido do usuário):
-- ver .dev/specs/aggregated-metrics/sql-aggregation.md e
-- .dev/specs/intelligence-center/sentiment-analysis.md pra contexto
-- completo de cada um.

-- =========================================================================
-- 1) get_narrative_sentiment_breakdown — bloco `breakdowns` (type =
-- 'narrative'), novo. Fonte: narrative_metrics.sentiment_positive/neutral/
-- negative (já sincronizado, não amostrado — mesma coluna usada por
-- get_theme_breakdown, só que aqui devolvendo o split completo por
-- Narrativa em vez de um net_sentiment médio ponderado por Pauta).
-- Diferente de get_theme_breakdown (Pautas = Category raiz), esta function
-- é escopada às Narrativas-folha (Subcategory, bc.parent_id is not null) —
-- mesma granularidade já usada pela aba Narrativas/`get_narratives_table`
-- com p_scope='leaves' (ver CLAUDE.md, "Overview vs. Narrativas vs. Pautas
-- Eleitorais"). Exige bw_categories.status='active' (Category removida da
-- Brandwatch não aparece).
-- =========================================================================

create or replace function get_narrative_sentiment_breakdown(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  label text,
  positive numeric,
  neutral numeric,
  negative numeric,
  total_mentions bigint,
  pct numeric
)
language sql
stable
as $$
  with cat_ids as (
    select filter_category_ids(p_organization_id, p_filters) as ids
  ),
  leaf_narratives as (
    select n.id as narrative_id, n.title
    from narratives n
    join bw_categories bc on bc.id = n.bw_category_id
    cross join cat_ids
    where n.organization_id = p_organization_id
      and bc.parent_id is not null
      and bc.status = 'active'
      and (cat_ids.ids is null or n.bw_category_id = any(cat_ids.ids))
  ),
  scoped as (
    select nm.*
    from narrative_metrics nm
    join leaf_narratives ln on ln.narrative_id = nm.narrative_id
    where nm.period = 'daily'
      and nm.metric_date between p_period_start and p_period_end
  ),
  per_narrative as (
    select
      ln.narrative_id,
      ln.title,
      sum(s.total_mentions) as total_mentions,
      sum(s.sentiment_positive) as pos,
      sum(s.sentiment_neutral) as neu,
      sum(s.sentiment_negative) as neg
    from leaf_narratives ln
    left join scoped s on s.narrative_id = ln.narrative_id
    group by ln.narrative_id, ln.title
  ),
  grand_total as (
    select sum(total_mentions) as total from per_narrative
  )
  select
    title as label,
    round(coalesce(pos, 0) * 100.0 / nullif(coalesce(pos, 0) + coalesce(neu, 0) + coalesce(neg, 0), 0), 1) as positive,
    round(coalesce(neu, 0) * 100.0 / nullif(coalesce(pos, 0) + coalesce(neu, 0) + coalesce(neg, 0), 0), 1) as neutral,
    round(coalesce(neg, 0) * 100.0 / nullif(coalesce(pos, 0) + coalesce(neu, 0) + coalesce(neg, 0), 0), 1) as negative,
    coalesce(total_mentions, 0) as total_mentions,
    round(coalesce(total_mentions, 0) * 100.0 / nullif((select total from grand_total), 0), 1) as pct
  from per_narrative
  order by total_mentions desc nulls last
$$;

-- =========================================================================
-- 2) get_authors_ranking — adiciona sentiment_positive/neutral/negative
-- (nullable). NUNCA lê bw_query_top_authors.sentiment_*/
-- bw_query_top_tweeters.sentiment_* — essas colunas foram escritas desde a
-- criação da tabela (migration 20260710010000) a partir de `d.sentiment` da
-- resposta de data/volume/topauthors/queries, mas, diferente de todo campo
-- vizinho na mesma tabela (tweets/retweets/account_type/country_code, todos
-- com nota "confirmado contra developers.brandwatch.com/docs/top-tweeters"),
-- esse campo NUNCA foi confirmado contra a documentação real do endpoint —
-- o payload documentado (authorVolume/reachEstimate/impact/twitterFollowers/
-- twitterTweets/twitterRetweets/authorAccountType/countryCode) não cita um
-- objeto `sentiment`. Risco real de estar sempre 0/0/0 em produção (fallback
-- `?? 0` sem erro). Ver data-model.md, "bw_query_top_authors" — achado,
-- não corrigido/removido nesta migration (decisão do usuário: documentar,
-- não gastar chamada nova pra confirmar/substituir agora).
--
-- Fonte usada aqui: bw_query_author_topics (data/topics?queryId=X&author=
-- <handle>, mesmo padrão já confirmado pro impressions por autor) — soma os
-- 3 contadores de sentimento entre todos os temas do autor na semana mais
-- recente sincronizada PARA AQUELE autor. Cada contador já é um agregado
-- oficial da Brandwatch por tema; somar entre temas do MESMO autor não
-- reintroduz agregação local sobre mentions amostrada (mesmo raciocínio já
-- usado por refresh_narrative_metrics() combinando fontes oficiais
-- diferentes). Limitação herdada: só os top 10 autores por volume da Query
-- inteira são enriquecidos (ver data-model.md, "bw_query_author_topics") —
-- para os demais, os 3 campos vêm `null`, nunca `0/0/0` (nunca inventar
-- "sem sentimento" como "sentimento neutro").
-- =========================================================================

create or replace function get_authors_ranking(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  entity_id uuid,
  name text,
  type text,
  reach numeric,
  engagement numeric,
  risk_level text,
  is_influential boolean,
  sentiment_positive integer,
  sentiment_neutral integer,
  sentiment_negative integer
)
language sql
stable
as $$
  with cat_ids as (
    select filter_category_ids(p_organization_id, p_filters) as ids
  ),
  use_tweeters as (
    select coalesce((p_filters -> 'platforms') ? 'twitter', false)
        or coalesce((p_filters -> 'platforms') ? 'x', false) as flag
  ),
  scoped_authors as (
    select author, volume, reach_estimate, impact, account_type, is_influential, metric_week, category_id, query_id
    from bw_query_top_authors
    where not (select flag from use_tweeters)
    union all
    select author, volume, reach_estimate, impact, account_type, is_influential, metric_week, category_id, query_id
    from bw_query_top_tweeters
    where (select flag from use_tweeters)
  ),
  filtered as (
    select sa.*
    from scoped_authors sa
    cross join cat_ids
    where sa.query_id in (select org_query_ids(p_organization_id))
      and (
        (cat_ids.ids is null and sa.category_id is null)
        or sa.category_id = any(cat_ids.ids)
      )
  ),
  latest_week as (
    select max(metric_week) as w from filtered
  ),
  ranked as (
    select *
    from filtered
    where metric_week = (select w from latest_week)
  ),
  author_sentiment as (
    select
      at.author,
      sum(at.sentiment_positive) as sentiment_positive,
      sum(at.sentiment_neutral) as sentiment_neutral,
      sum(at.sentiment_negative) as sentiment_negative
    from bw_query_author_topics at
    where at.query_id in (select org_query_ids(p_organization_id))
      and at.metric_week = (
        select max(at2.metric_week) from bw_query_author_topics at2 where at2.author = at.author
      )
    group by at.author
  )
  select
    null::uuid as entity_id,
    r.author as name,
    coalesce(r.account_type, 'unknown') as type,
    r.reach_estimate::numeric as reach,
    r.impact as engagement,
    null::text as risk_level,
    coalesce(r.is_influential, false) as is_influential,
    asent.sentiment_positive,
    asent.sentiment_neutral,
    asent.sentiment_negative
  from ranked r
  left join author_sentiment asent on asent.author = r.author
  order by r.volume desc nulls last
$$;
