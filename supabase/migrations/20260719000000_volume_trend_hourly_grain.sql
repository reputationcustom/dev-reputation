-- get_volume_trend ganha grão "hour" para o modo "Diário" (2026-07-19,
-- pedido do usuário: "quando selecionado a visão diária o gráfico de
-- volume e sentimento precisa ser alterado para mostrar por hora").
--
-- A regra de grão automático já existente (foundation/overview.md via
-- aggregated-metrics/sql-aggregation.md: ≤31d → day, 32-186d → week, >186d
-- → month) nunca cobria o caso "Diário" (1 dia, `period.start ===
-- period.end` — ver header-context.tsx, PERIOD_MODE_DAYS.daily = 1): caía
-- no mesmo bucket "day" das outras janelas curtas, devolvendo 1 único
-- ponto (o dia inteiro) — inútil como série temporal. Fonte:
-- bw_query_metrics_hourly (foundation, migration 20260713040000 — janela
-- móvel de 30 dias, sempre fresca, não é histórico/BI). Nova regra:
-- período de exatamente 1 dia → grão "hour"; do contrário, regra anterior
-- sem mudança.
--
-- `bucket_date` muda de `date` para `text`: grão "hour" precisa devolver
-- instante com hora, não só a data — `to_char(... at time zone 'utc', ...)`
-- devolve um ISO 8601 UTC completo ("2026-07-19T14:00:00Z"), os grãos
-- day/week/month continuam devolvendo só a data ("2026-07-19", 10
-- caracteres) — o frontend (`TrendLineChart`) distingue os dois formatos
-- pelo comprimento da string pra decidir como formatar o eixo/tooltip
-- (hora vs. data), sem precisar de um campo de grão explícito no envelope
-- (`Trend`/`TrendPoint` continuam com `date: string`, sem mudança de tipo).
-- `CREATE OR REPLACE` não permite mudar o tipo de retorno de uma function
-- existente — precisa `drop` antes.
drop function if exists get_volume_trend(uuid, date, date, jsonb);

create function get_volume_trend(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  bucket_date text,
  total_mentions integer,
  sentiment_positive integer,
  sentiment_neutral integer,
  sentiment_negative integer,
  net_sentiment numeric
)
language sql
stable
as $$
  with grain as (
    select case
      when (p_period_end - p_period_start + 1) = 1 then 'hour'
      when (p_period_end - p_period_start + 1) <= 31 then 'day'
      when (p_period_end - p_period_start + 1) <= 186 then 'week'
      else 'month'
    end as g
  ),
  cat_ids as (
    select filter_category_ids(p_organization_id, p_filters) as ids
  ),
  hourly as (
    select to_char(metric_hour at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as bucket_date,
           total_mentions, sentiment_positive, sentiment_neutral, sentiment_negative, net_sentiment
    from bw_query_metrics_hourly
    cross join cat_ids
    where (select g from grain) = 'hour'
      and query_id in (select org_query_ids(p_organization_id))
      and metric_hour >= p_period_start::timestamptz
      and metric_hour < (p_period_end + 1)::timestamptz
      and (
        (cat_ids.ids is null and category_id is null)
        or category_id = any(cat_ids.ids)
      )
  ),
  daily as (
    select to_char(metric_date, 'YYYY-MM-DD') as bucket_date, total_mentions, sentiment_positive, sentiment_neutral,
           sentiment_negative, net_sentiment
    from bw_query_metrics_daily
    cross join cat_ids
    where (select g from grain) = 'day'
      and query_id in (select org_query_ids(p_organization_id))
      and metric_date between p_period_start and p_period_end
      and (
        (cat_ids.ids is null and category_id is null)
        or category_id = any(cat_ids.ids)
      )
  ),
  weekly as (
    select to_char(metric_week, 'YYYY-MM-DD') as bucket_date, total_mentions, sentiment_positive, sentiment_neutral,
           sentiment_negative, null::numeric as net_sentiment
    from bw_query_metrics_weekly
    cross join cat_ids
    where (select g from grain) = 'week'
      and query_id in (select org_query_ids(p_organization_id))
      and metric_week between p_period_start and p_period_end
      and (
        (cat_ids.ids is null and category_id is null)
        or category_id = any(cat_ids.ids)
      )
  ),
  monthly as (
    select to_char(metric_month, 'YYYY-MM-DD') as bucket_date, total_mentions, sentiment_positive, sentiment_neutral,
           sentiment_negative, null::numeric as net_sentiment
    from bw_query_metrics_monthly
    cross join cat_ids
    where (select g from grain) = 'month'
      and query_id in (select org_query_ids(p_organization_id))
      and metric_month between p_period_start and p_period_end
      and (
        (cat_ids.ids is null and category_id is null)
        or category_id = any(cat_ids.ids)
      )
  ),
  unioned as (
    select * from hourly
    union all select * from daily
    union all select * from weekly
    union all select * from monthly
  )
  select
    bucket_date,
    sum(total_mentions)::integer as total_mentions,
    sum(sentiment_positive)::integer as sentiment_positive,
    sum(sentiment_neutral)::integer as sentiment_neutral,
    sum(sentiment_negative)::integer as sentiment_negative,
    case when bool_or(net_sentiment is not null)
      then round(sum(net_sentiment * total_mentions) / nullif(sum(total_mentions) filter (where net_sentiment is not null), 0), 1)
      else null
    end as net_sentiment
  from unioned
  group by bucket_date
  order by bucket_date
$$;
