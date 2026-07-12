-- Pedido do usuário (2026-07-12), respondendo às pendências levantadas para
-- as novas specs de `intelligence-center`: "Autores únicos já existe na
-- brandwatch, precisamos rever o que estamos capturando por API e caso seja
-- necessário ajustar" + mesma resposta para sentimento/engajamento/autores
-- por plataforma e sentimento por localização.
--
-- Confirmado direto contra developers.brandwatch.com/docs/
-- chart-dimensions-and-aggregates: `authors` ("aggregate by the authors of
-- the mentions" / "distinct authors who posted") e `netSentiment` são
-- aggregates de chart oficiais e não amostrados, mesma família que já
-- sustenta reachEstimate/engagementScore. Ver foundation/data-model.md
-- para o racional completo por coluna.
--
-- Bug encontrado no mesmo levantamento: a linha "Query inteira"
-- (category_id is null) de bw_query_metrics_daily nunca teve
-- reach_estimate/engagement_score populados — syncCategoryDailyAggregate()
-- só cobre a dimensão `categories`, que nunca inclui uma linha da Query
-- inteira. Corrigido junto (ver bw-sync/index.ts, syncQueryDailyAggregate()).

alter table bw_query_metrics_daily
  add column if not exists unique_authors integer;

alter table bw_query_metrics_daily_by_platform
  add column if not exists unique_authors integer,
  add column if not exists engagement_score numeric,
  add column if not exists net_sentiment numeric;

alter table bw_query_demographics_daily
  add column if not exists net_sentiment numeric;

alter table narrative_metrics
  add column if not exists unique_authors integer;

-- refresh_narrative_metrics() ganha unique_authors no insert/upsert —
-- mesma fonte (bw_query_metrics_daily), mesma regra de "só o que a
-- Brandwatch expõe como agregado oficial, nunca soma local sobre mentions".
create or replace function refresh_narrative_metrics(
  p_from date default current_date - 1,
  p_to date default current_date - 1
)
returns void
language plpgsql
as $$
begin
  insert into narrative_metrics (
    narrative_id, query_id, metric_date, period, source,
    total_mentions, sentiment_positive, sentiment_neutral, sentiment_negative,
    reach_estimated, engagement_total, unique_authors
  )
  select
    n.id, q.query_id, q.metric_date, 'daily', 'bw_aggregate',
    q.total_mentions, q.sentiment_positive, q.sentiment_neutral, q.sentiment_negative,
    q.reach_estimate, q.engagement_score, q.unique_authors
  from narratives n
  join bw_categories bc on bc.id = n.bw_category_id
  join bw_query_metrics_daily q
    on q.category_id = n.bw_category_id
    and q.query_id = any(bc.query_ids)
    and q.metric_date between p_from and p_to
  where n.bw_category_id is not null
    and array_length(bc.query_ids, 1) = 1
  on conflict (narrative_id, metric_date, period) do update set
    query_id = excluded.query_id,
    source = excluded.source,
    total_mentions = excluded.total_mentions,
    sentiment_positive = excluded.sentiment_positive,
    sentiment_neutral = excluded.sentiment_neutral,
    sentiment_negative = excluded.sentiment_negative,
    reach_estimated = excluded.reach_estimated,
    engagement_total = excluded.engagement_total,
    unique_authors = excluded.unique_authors;
end;
$$;
