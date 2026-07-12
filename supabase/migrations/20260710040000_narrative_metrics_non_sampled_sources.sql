-- Pedido do usuário (2026-07-10): "Como as menções trazidas na integração
-- são apenas amostras, é importante que as narrativas e as métricas por
-- narrativa sejam buscadas diferentemente na brandwatch, bem como o
-- engajamento, sentimento, o alcance, a influência do autor..."
--
-- Correto: sentimento/volume por Narrativa já vinham de
-- `data/volume/sentiment/days` (agregado oficial, não amostrado — via
-- `bw_query_metrics_daily`). Mas `engagement_total`/`reach_estimated` que
-- `refresh_narrative_metrics()` calculava (migration `20260710030000`)
-- eram somados localmente sobre `mentions`, que **é** amostrada em Queries
-- de alto volume — subestimando exatamente como a nota de sampling em
-- `narratives.md` sempre alertou.
--
-- Fix: `reach_estimate`/`engagement_score` viram colunas de
-- `bw_query_metrics_daily`, populadas por `data/reachEstimate/categories/days`
-- e `data/engagementScore/categories/days` — a dimensão `categories`
-- (confirmada contra chart-dimensions-and-aggregates da Brandwatch) devolve
-- o breakdown de TODAS as Categories numa única chamada, não amostrado,
-- mesma família de endpoint que já alimenta total_mentions/sentimento.
-- `refresh_narrative_metrics()` passa a ler esses dois campos dali em vez
-- de calcular localmente — com fallback pro cálculo local só enquanto o
-- histórico antigo ainda não foi resincronizado com as colunas novas.
--
-- `unique_authors`/`top_domain`/`repost_count`/`comment_count` continuam
-- agregação local (Brandwatch não expõe esses quebrados por Category em
-- nenhum aggregate) — documentado explicitamente como aproximado/sujeito a
-- sampling em Queries de alto volume, ao contrário dos demais campos.
--
-- "Influência do autor" por Narrativa: bw_query_top_authors
-- (data/volume/topauthors/queries, também não amostrado) ganha
-- category_id — mesma chamada, agora filtrada por Category quando
-- aplicável, dando ranking de autores por Narrativa em vez de só por
-- Query inteira.

alter table bw_query_metrics_daily
  add column if not exists reach_estimate integer,
  add column if not exists engagement_score numeric;

alter table bw_query_top_authors
  add column if not exists category_id bigint references bw_categories(id) on delete cascade,
  add column if not exists category_id_key bigint generated always as (coalesce(category_id, 0)) stored;

-- Nome do constraint unique original é auto-gerado pelo Postgres (>60
-- caracteres, sujeito a truncamento não-trivial) — busca dinamicamente em
-- vez de arriscar acertar o nome exato na mão.
do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'bw_query_top_authors'::regclass
    and contype = 'u';
  if v_constraint_name is not null then
    execute format('alter table bw_query_top_authors drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table bw_query_top_authors add constraint bw_query_top_authors_unique
  unique (project_id, query_id, category_id_key, author, metric_week);

-- engagement_total guardava soma local de likes (integer); agora guarda o
-- engagementScore oficial da Brandwatch, que pode ser fracionário.
alter table narrative_metrics alter column engagement_total type numeric;

create or replace function refresh_narrative_metrics(
  p_from date default current_date - 1,
  p_to date default current_date - 1
)
returns void
language plpgsql
as $$
begin
  -- Via 1: total_mentions/sentimento/reach/engagement do agregado oficial
  -- da Brandwatch (bw_query_metrics_daily — não amostrado). Fallback pro
  -- cálculo local (eng.reach_estimated_local/engagement_total_local) só
  -- enquanto reach_estimate/engagement_score ainda não tiverem sido
  -- resincronizados pro dia em questão (colunas novas, histórico antigo
  -- ainda não tem essas 2 colunas preenchidas até o próximo bw-sync rodar
  -- data/reachEstimate|engagementScore/categories/days pra aquele range).
  -- unique_authors/top_domain/repost_count/comment_count continuam locais
  -- — Brandwatch não expõe esses quebrados por Category em nenhum
  -- aggregate, então ficam sujeitos à mesma ressalva de sampling de
  -- sempre (documentado em narrative_metrics, ver data-model.md).
  insert into narrative_metrics (
    narrative_id, metric_date, period, source,
    total_mentions, sentiment_positive, sentiment_neutral, sentiment_negative,
    unique_authors, reach_estimated, top_domain,
    engagement_total, repost_count, comment_count
  )
  select
    n.id, q.metric_date, 'daily', 'bw_aggregate',
    q.total_mentions, q.sentiment_positive, q.sentiment_neutral, q.sentiment_negative,
    eng.unique_authors,
    coalesce(q.reach_estimate, eng.reach_estimated_local),
    eng.top_domain,
    coalesce(q.engagement_score, eng.engagement_total_local),
    eng.repost_count, eng.comment_count
  from narratives n
  join bw_query_metrics_daily q
    on q.category_id = n.bw_category_id and q.metric_date between p_from and p_to
  left join lateral (
    select
      count(distinct m.author_handle_normalized) as unique_authors,
      mode() within group (order by m.domain) as top_domain,
      sum(m.reach_estimate) as reach_estimated_local,
      sum(mention_engagement_likes(m.engagement)) as engagement_total_local,
      sum(mention_engagement_reposts(m.engagement)) as repost_count,
      sum(mention_engagement_comments(m.engagement)) as comment_count
    from narrative_matched_mentions(n.id, q.metric_date::timestamptz, (q.metric_date + 1)::timestamptz) m
  ) eng on true
  where n.bw_category_id is not null
  on conflict (narrative_id, metric_date, period) do update set
    source = excluded.source,
    total_mentions = excluded.total_mentions,
    sentiment_positive = excluded.sentiment_positive,
    sentiment_neutral = excluded.sentiment_neutral,
    sentiment_negative = excluded.sentiment_negative,
    unique_authors = excluded.unique_authors,
    reach_estimated = excluded.reach_estimated,
    top_domain = excluded.top_domain,
    engagement_total = excluded.engagement_total,
    repost_count = excluded.repost_count,
    comment_count = excluded.comment_count;

  -- Via 2: Narrativas sem bw_category_id (só sinais) — sem agregado
  -- oficial por Category possível (não existe Category pra filtrar),
  -- continua 100% local/amostrada, como sempre foi.
  insert into narrative_metrics (
    narrative_id, metric_date, period, source,
    total_mentions, unique_authors, sentiment_positive, sentiment_neutral,
    sentiment_negative, reach_estimated, top_domain,
    engagement_total, repost_count, comment_count
  )
  select
    n.id, d.metric_date, 'daily', 'mentions_sample',
    count(*),
    count(distinct m.author_handle_normalized),
    count(*) filter (where m.sentiment = 'positive'),
    count(*) filter (where m.sentiment = 'neutral'),
    count(*) filter (where m.sentiment = 'negative'),
    sum(m.reach_estimate),
    mode() within group (order by m.domain),
    sum(mention_engagement_likes(m.engagement)),
    sum(mention_engagement_reposts(m.engagement)),
    sum(mention_engagement_comments(m.engagement))
  from narratives n
  cross join generate_series(p_from, p_to, interval '1 day') as d(metric_date)
  join lateral narrative_matched_mentions(
    n.id, d.metric_date::timestamptz, (d.metric_date + interval '1 day')::timestamptz
  ) m on true
  where n.bw_category_id is null
  group by n.id, d.metric_date
  on conflict (narrative_id, metric_date, period) do update set
    source = excluded.source,
    total_mentions = excluded.total_mentions,
    unique_authors = excluded.unique_authors,
    sentiment_positive = excluded.sentiment_positive,
    sentiment_neutral = excluded.sentiment_neutral,
    sentiment_negative = excluded.sentiment_negative,
    reach_estimated = excluded.reach_estimated,
    top_domain = excluded.top_domain,
    engagement_total = excluded.engagement_total,
    repost_count = excluded.repost_count,
    comment_count = excluded.comment_count;
end;
$$;
