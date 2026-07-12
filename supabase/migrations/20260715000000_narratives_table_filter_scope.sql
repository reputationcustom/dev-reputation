-- Módulo: aggregated-metrics
-- Fonte: .dev/specs/aggregated-metrics/sql-aggregation.md, .dev/specs/aggregated-metrics/
-- edge-functions-per-page.md (get-narrative-detail)
--
-- Gap encontrado ao implementar get-narrative-detail: o cabeçalho de detalhe de Narrativa
-- (intelligence-center/narratives-exploration.md, "Cabeçalho: nome, badges de SOV/sentimento/
-- risco/momentum/velocidade — mesmos scores e faixas de executive-overview.md") precisa dos
-- scores de UMA Narrativa específica, mas get_narratives_table (migration 20260714000000) só
-- aceita `p_pauta_id` (filtra pra Narrativas FILHAS de uma pauta) — não havia como pedir "só esta
-- Narrativa". `p_filters` já era aceito na assinatura mas nunca lido dentro da function.
--
-- Fix: `scope` passa a respeitar `filters.narratives` (mesmo array de narrative id já usado por
-- filter_category_ids() em todas as outras functions deste módulo) — quando presente e não
-- vazio, restringe a exatamente essas Narrativas; vazio/ausente mantém o comportamento atual
-- (todas as Narrativas da organização, ou as filhas de p_pauta_id). Não quebra nenhum chamador
-- existente — service-layer-aggregation.md's effectiveFilters() já popula
-- filters.narratives = [narrativeId] quando PageContext.narrativeId está setado; até agora isso
-- não tinha efeito nesta function especificamente porque ela ignorava p_filters.

create or replace function get_narratives_table(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb,
  p_pauta_id uuid default null
)
returns table (
  id uuid,
  title text,
  sov_pct numeric,
  total_mentions integer,
  net_sentiment numeric,
  sentiment_label text,
  momentum_score numeric,
  velocity_score numeric,
  velocity_label text,
  risk_score numeric,
  risk_label text
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
  narrative_ids as (
    select nullif(array_agg((elem)::uuid), '{}') as ids
    from jsonb_array_elements_text(coalesce(p_filters -> 'narratives', '[]'::jsonb)) as elem
  ),
  scope as (
    select n.id, n.bw_category_id
    from narratives n
    cross join narrative_ids
    where n.organization_id = p_organization_id
      and (
        p_pauta_id is null
        or n.bw_category_id in (
          select bc.id from bw_categories bc
          where bc.parent_id = (select bw_category_id from narratives where id = p_pauta_id)
        )
      )
      and (narrative_ids.ids is null or n.id = any(narrative_ids.ids))
  ),
  latest_day as (
    select distinct on (nv.narrative_id)
      nv.narrative_id, nv.title, nv.sov_percent, nv.total_mentions,
      nv.net_sentiment, nv.sentiment_bucket, nm.query_id
    from public.narratives_overview nv
    join narrative_metrics nm
      on nm.narrative_id = nv.narrative_id and nm.metric_date = nv.metric_date and nm.period = 'daily'
    where nv.organization_id = p_organization_id
      and nv.metric_date between p_period_start and p_period_end
      and nv.narrative_id in (select id from scope)
    order by nv.narrative_id, nv.metric_date desc
  ),
  period_agg as (
    select
      narrative_id,
      sum(total_mentions) filter (where metric_date between p_period_start and p_period_end) as vol_current,
      sum(total_mentions) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as vol_previous,
      sum(engagement_total) filter (where metric_date between p_period_start and p_period_end) as engagement_current,
      sum(engagement_total) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as engagement_previous,
      avg(unique_authors) filter (where metric_date between p_period_start and p_period_end) as authors_current,
      avg(unique_authors) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as authors_previous,
      sum(reach_estimated) filter (where metric_date between p_period_start and p_period_end) as reach_current,
      sum(reach_estimated) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as reach_previous
    from narrative_metrics
    where period = 'daily'
      and narrative_id in (select id from scope)
      and metric_date between (select prev_start from prev_range) and p_period_end
    group by narrative_id
  ),
  velocity_agg as (
    select
      s.id as narrative_id,
      sum(h.total_mentions) filter (where h.metric_hour >= now() - interval '3 hours') as last_3h,
      sum(h.total_mentions) filter (where h.metric_hour >= now() - interval '6 hours' and h.metric_hour < now() - interval '3 hours') as previous_3h
    from scope s
    left join bw_query_metrics_hourly h
      on h.category_id = s.bw_category_id
      and h.metric_hour >= now() - interval '6 hours'
    group by s.id
  ),
  latest_week_per_category as (
    select category_id, max(metric_week) as latest_week
    from bw_query_top_authors
    where category_id is not null
    group by category_id
  ),
  author_influence_agg as (
    select
      s.id as narrative_id,
      count(*) filter (where a.is_influential) * 100.0 / nullif(count(*), 0) as author_influence
    from scope s
    join latest_week_per_category lw on lw.category_id = s.bw_category_id
    left join bw_query_top_authors a on a.category_id = s.bw_category_id and a.metric_week = lw.latest_week
    group by s.id
  ),
  momentum as (
    select
      ld.narrative_id,
      round(
        0.40 * norm_growth(pa.vol_current, pa.vol_previous) +
        0.25 * norm_growth(pa.engagement_current, pa.engagement_previous) +
        0.20 * norm_growth(pa.authors_current, pa.authors_previous) +
        0.15 * norm_growth(pa.reach_current, pa.reach_previous)
      ) as momentum_score
    from latest_day ld
    left join period_agg pa on pa.narrative_id = ld.narrative_id
  ),
  velocity as (
    select
      ld.narrative_id,
      norm_growth(va.last_3h, va.previous_3h) as velocity_score
    from latest_day ld
    left join velocity_agg va on va.narrative_id = ld.narrative_id
  ),
  risk_inputs as (
    select
      ld.narrative_id,
      greatest(0, least(100, (100 - coalesce(ld.net_sentiment, 0)) / 2.0)) as sentiment_risk,
      m.momentum_score,
      v.velocity_score,
      coalesce(pa.reach_current, 0) * 100.0 / nullif(max(coalesce(pa.reach_current, 0)) over (partition by ld.query_id), 0) as reach_risk,
      coalesce(pa.engagement_current, 0) * 100.0 / nullif(max(coalesce(pa.engagement_current, 0)) over (partition by ld.query_id), 0) as impact_risk,
      coalesce(ai.author_influence, 0) as author_influence
    from latest_day ld
    left join period_agg pa on pa.narrative_id = ld.narrative_id
    left join momentum m on m.narrative_id = ld.narrative_id
    left join velocity v on v.narrative_id = ld.narrative_id
    left join author_influence_agg ai on ai.narrative_id = ld.narrative_id
  ),
  risk as (
    select
      narrative_id,
      round(
        0.25 * sentiment_risk +
        0.25 * coalesce(momentum_score, 50) +
        0.20 * coalesce(velocity_score, 50) +
        0.15 * coalesce(reach_risk, 0) +
        0.10 * author_influence +
        0.05 * coalesce(impact_risk, 0)
      ) as risk_score
    from risk_inputs
  )
  select
    ld.narrative_id as id,
    ld.title,
    ld.sov_percent as sov_pct,
    ld.total_mentions,
    ld.net_sentiment,
    ld.sentiment_bucket as sentiment_label,
    m.momentum_score,
    v.velocity_score,
    case
      when v.velocity_score is null then null
      when v.velocity_score < 20 then 'shrinking_fast'
      when v.velocity_score < 40 then 'declining'
      when v.velocity_score < 60 then 'stable'
      when v.velocity_score < 80 then 'growing'
      else 'viral'
    end as velocity_label,
    r.risk_score,
    case
      when r.risk_score is null then null
      when r.risk_score < 34 then 'low'
      when r.risk_score < 60 then 'medium'
      when r.risk_score < 85 then 'high'
      else 'critical'
    end as risk_label
  from latest_day ld
  left join momentum m on m.narrative_id = ld.narrative_id
  left join velocity v on v.narrative_id = ld.narrative_id
  left join risk r on r.narrative_id = ld.narrative_id
  order by r.risk_score desc nulls last, ld.total_mentions desc nulls last
$$;
