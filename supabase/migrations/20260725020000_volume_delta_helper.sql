-- get_volume_delta — helper novo, usado só pela Camada 0 de
-- aggregated-metrics/ai-synthesis.md (narrative_text, template
-- determinístico sem IA — ver _pending.md #27, achado nesta revisão que
-- nem essa camada, mais simples que Camada 1/page_narrative_synthesis,
-- estava implementada). Não é um bloco do envelope — é lido só pela
-- service layer (fetchNarrativeText) pra montar o texto "Volume
-- {cresceu|caiu} de X% em relação ao período anterior" quando não há
-- highlight nenhum no escopo (hoje sempre o caso, get_active_highlights
-- ainda não existe).
--
-- Não reusa get_metrics_cards porque aquela function é sempre "Query
-- inteira" (category_id is null, sem suporte a filters.narratives) — a
-- página de detalhe de Narrativa (narrative_detail) também precisa deste
-- texto, mas escopado à Narrativa aberta, não à Query inteira. Mesmo
-- padrão de cat_ids/org_query_ids já usado por get_sentiment_breakdown.

create or replace function get_volume_delta(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  current_value bigint,
  previous_value bigint,
  delta_pct numeric,
  trend text
)
language sql
stable
set search_path = public
as $$
  with period_len as (
    select (p_period_end - p_period_start + 1) as days
  ),
  prev_range as (
    select (p_period_start - (select days from period_len)) as prev_start,
           (p_period_start - 1) as prev_end
  ),
  cat_ids as (
    select filter_category_ids(p_organization_id, p_filters) as ids
  ),
  scoped as (
    select d.*
    from bw_query_metrics_daily d
    cross join cat_ids
    where d.query_id in (select org_query_ids(p_organization_id))
      and (
        (cat_ids.ids is null and d.category_id is null)
        or d.category_id = any(cat_ids.ids)
      )
  ),
  current_agg as (
    select coalesce(sum(total_mentions), 0) as total
    from scoped
    where metric_date between p_period_start and p_period_end
  ),
  previous_agg as (
    select coalesce(sum(total_mentions), 0) as total
    from scoped
    where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)
  )
  select
    (select total from current_agg)::bigint as current_value,
    (select total from previous_agg)::bigint as previous_value,
    case when (select total from previous_agg) = 0 then null
         else round((((select total from current_agg) - (select total from previous_agg))::numeric
              / (select total from previous_agg)) * 100, 1)
    end as delta_pct,
    case
      when (select total from previous_agg) = 0 then 'stable'
      when (select total from current_agg) > (select total from previous_agg) then 'up'
      when (select total from current_agg) < (select total from previous_agg) then 'down'
      else 'stable'
    end as trend
$$;

comment on function get_volume_delta(uuid, date, date, jsonb) is
  'Helper de ai-synthesis.md Camada 0 (narrative_text) — total_mentions do período atual vs. anterior, escopado por filters.narratives (mesmo padrão de get_sentiment_breakdown). Não é um bloco do envelope, só consumido pela service layer.';
