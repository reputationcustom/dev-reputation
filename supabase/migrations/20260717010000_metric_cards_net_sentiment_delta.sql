-- get_metrics_cards: corrige o cálculo de variação do card "Sentimento
-- geral" (2026-07-12, pedido do usuário: "Definir o sentimento geral
-- utilizando o net_sentiment e apresentá-lo como % e aumento ou diminuição
-- em pontos percentuais").
--
-- net_sentiment já é um score -100..100 (não uma contagem) — a fórmula
-- genérica de variação relativa ((atual - anterior) / anterior * 100),
-- correta para total_mentions/reach_estimate/engagement_score/
-- unique_authors, não faz sentido pra um score que pode cruzar zero ou
-- trocar de sinal (divisão por um valor perto de zero produz uma "%" sem
-- significado). Pra este metric_key especificamente, delta_pct passa a
-- guardar a diferença absoluta em pontos percentuais (current_value -
-- previous_value), não a variação relativa — o frontend (metric-card.tsx)
-- já sabe renderizar isso como "X p.p." em vez de "X%" via
-- unit = 'net_sentiment_pct' (METRIC_META, aggregated-metrics-service.ts).
create or replace function get_metrics_cards(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  metric_key text,
  current_value numeric,
  previous_value numeric,
  delta_pct numeric,
  trend text
)
language sql
stable
as $$
  with period_len as (
    select (p_period_end - p_period_start + 1) as days
  ),
  prev_range as (
    select (p_period_start - (select days from period_len)) as prev_start,
           (p_period_start - 1) as prev_end
  ),
  current_agg as (
    select
      sum(total_mentions) as total_mentions,
      sum(reach_estimate) as reach_estimate,
      sum(engagement_score) as engagement_score,
      sum(unique_authors) as unique_authors,
      sum(net_sentiment * total_mentions) filter (where net_sentiment is not null) as net_sentiment_weighted,
      sum(total_mentions) filter (where net_sentiment is not null) as net_sentiment_weight
    from bw_query_metrics_daily
    where query_id in (select org_query_ids(p_organization_id))
      and category_id is null
      and metric_date between p_period_start and p_period_end
  ),
  previous_agg as (
    select
      sum(total_mentions) as total_mentions,
      sum(reach_estimate) as reach_estimate,
      sum(engagement_score) as engagement_score,
      sum(unique_authors) as unique_authors,
      sum(net_sentiment * total_mentions) filter (where net_sentiment is not null) as net_sentiment_weighted,
      sum(total_mentions) filter (where net_sentiment is not null) as net_sentiment_weight
    from bw_query_metrics_daily
    where query_id in (select org_query_ids(p_organization_id))
      and category_id is null
      and metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)
  ),
  metrics as (
    select 'total_mentions' as metric_key,
           coalesce((select total_mentions from current_agg), 0)::numeric as current_value,
           coalesce((select total_mentions from previous_agg), 0)::numeric as previous_value
    union all
    select 'reach_estimate',
           coalesce((select reach_estimate from current_agg), 0)::numeric,
           coalesce((select reach_estimate from previous_agg), 0)::numeric
    union all
    select 'engagement_score',
           coalesce((select engagement_score from current_agg), 0)::numeric,
           coalesce((select engagement_score from previous_agg), 0)::numeric
    union all
    select 'unique_authors',
           coalesce((select unique_authors from current_agg), 0)::numeric,
           coalesce((select unique_authors from previous_agg), 0)::numeric
    union all
    -- net_sentiment é score, não contagem — soma não faz sentido; usa média
    -- ponderada por total_mentions do próprio período (combina scores
    -- oficiais diários já não-amostrados, não recalcula sobre mentions).
    select 'net_sentiment',
           (select net_sentiment_weighted / nullif(net_sentiment_weight, 0) from current_agg),
           (select net_sentiment_weighted / nullif(net_sentiment_weight, 0) from previous_agg)
  )
  select
    metric_key,
    current_value,
    previous_value,
    case
      when metric_key = 'net_sentiment' then round(current_value - previous_value, 1)
      when previous_value is null or previous_value = 0 then null
      else round(((current_value - previous_value) / previous_value) * 100, 1)
    end as delta_pct,
    case
      when previous_value is null or current_value is null then 'stable'
      when current_value > previous_value then 'up'
      when current_value < previous_value then 'down'
      else 'stable'
    end as trend
  from metrics
$$;
