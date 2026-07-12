-- Pedido do usuário (2026-07-12): "verifique se todas as agregações da
-- página chart-dimensions-and-aggregates estão consideradas na integração
-- e estão disponíveis no supabase". Auditoria encontrou: `impressions` já
-- era capturado por autor (bw_query_top_authors.impressions, via
-- data/impressions/queries/days?queryId=X&author=Y) e por mention
-- individual (mentions.impressions, só X), mas nunca no nível de
-- Narrativa/Query inteira — mesmo agregado oficial de chart, mesma
-- dimensão `categories`/`queries` já usada por reach_estimate/
-- engagement_score/unique_authors (migration 20260712020000). Fecha o
-- mesmo padrão pra essa 4ª métrica.

alter table bw_query_metrics_daily
  add column if not exists impressions bigint;

alter table narrative_metrics
  add column if not exists impressions bigint;

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
    reach_estimated, engagement_total, unique_authors, impressions
  )
  select
    n.id, q.query_id, q.metric_date, 'daily', 'bw_aggregate',
    q.total_mentions, q.sentiment_positive, q.sentiment_neutral, q.sentiment_negative,
    q.reach_estimate, q.engagement_score, q.unique_authors, q.impressions
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
    unique_authors = excluded.unique_authors,
    impressions = excluded.impressions;
end;
$$;
