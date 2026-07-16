-- Módulo: foundation
-- Pedido do usuário (2026-07-16): "as categorias permanecem mesmo quando
-- excluídas da brandwatch. Inclua uma coluna de status, se ela não existir
-- na brandwatch, ela não mais será utilizada no sistema. Com isso o status
-- passa para inativo. A cada nova busca de dados essa verificação deve ser
-- realizada no endpoint de categorias e subcategorias."
--
-- bw_categories nunca foi deletada quando uma Category/Subcategory some da
-- Brandwatch (por design — bw_query_metrics_daily/bw_query_topics/
-- bw_query_top_authors têm FK `on delete cascade` pra ela, e narratives.
-- bw_category_id não tem cascade nenhum, ver CLAUDE.md "bw_categories
-- staleness reduced 24h → 1h"), mas também nunca sinalizava que uma
-- Category deixou de existir do lado da Brandwatch — uma renomeação/remoção
-- lá continuava aparecendo como "ativa" pra sempre no Supabase. `status`
-- fecha esse gap: `refreshMetadata()` (bw-sync/index.ts) passa a marcar
-- `inactive` toda Category/Subcategory do Project que não veio mais em
-- `GET /rulecategories` na última checagem (roda a cada refresh de
-- metadata, ver "bw_categories staleness" em CLAUDE.md — throttle de 1h,
-- forçado sempre que bw_categories está vazia). Nunca deleta.
--
-- Efeito em cascata, pedido explícito do usuário ("não mais será utilizada
-- no sistema"): get_narratives_table/get_theme_breakdown (aggregated-metrics)
-- passam a exigir bc.status = 'active' pra uma Narrativa aparecer em
-- qualquer listagem/score — Narrativas cuja Category foi desativada saem
-- das páginas por padrão, mas os dados históricos (bw_query_metrics_daily,
-- narrative_metrics) continuam intactos, só não são mais lidos por essas
-- duas functions. bw-sync também para de gastar orçamento de rate limit
-- sincronizando novo dado pra Categories inativas (ver
-- fetchNarrativeCategoryIds() em bw-sync/index.ts).

alter table bw_categories
  add column if not exists status text not null default 'active'
    constraint bw_categories_status_check check (status in ('active', 'inactive'));

comment on column bw_categories.status is
  'active = presente no último GET /rulecategories da Brandwatch; inactive = não veio mais, mas a linha é preservada por FK/histórico (nunca deletada). Ver CLAUDE.md, "Category/Subcategory status tracking".';

create index if not exists idx_bw_categories_project_status on bw_categories(project_id, status);

-- =========================================================================
-- get_narratives_table — ganha bc.status = 'active' (sempre) e um novo
-- p_scope opcional ('roots' | 'leaves' | null) pra resolver o pedido do
-- usuário: "na página de overview apenas a categoria [de topo], porém na
-- aba de narrativas considera-se as subcategorias". Quando p_pauta_id está
-- setado, o comportamento existente (Narrativas-filhas daquela Pauta,
-- electoral-themes.md) continua tendo prioridade sobre p_scope — é o mesmo
-- pedido ("considerar todas as subcategorias da categoria Pauta"), só que
-- restrito a uma Pauta específica em vez de todas.
-- Corpo copiado de 20260715000000_narratives_table_filter_scope.sql (última
-- versão), só a CTE `scope` e a assinatura mudam.
-- =========================================================================

create or replace function get_narratives_table(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb,
  p_pauta_id uuid default null,
  p_scope text default null
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
set search_path = public
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
    join bw_categories bc on bc.id = n.bw_category_id
    cross join narrative_ids
    where n.organization_id = p_organization_id
      and bc.status = 'active'
      and (
        (
          p_pauta_id is not null
          and bc.parent_id = (select bw_category_id from narratives where id = p_pauta_id)
        )
        or (
          p_pauta_id is null
          and (
            p_scope is null
            or (p_scope = 'roots' and bc.parent_id is null)
            or (p_scope = 'leaves' and bc.parent_id is not null)
          )
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

-- =========================================================================
-- get_theme_breakdown — mesma exigência bc.status = 'active' (já era
-- root-only por design, ver migration 20260714000000; não precisava de
-- p_scope, só do filtro de status).
-- =========================================================================

create or replace function get_theme_breakdown(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb,
  p_pauta_id uuid default null
)
returns table (
  label text,
  value numeric,
  pct numeric
)
language sql
stable
set search_path = public
as $$
  with root_narratives as (
    select n.id as narrative_id, n.title
    from narratives n
    join bw_categories bc on bc.id = n.bw_category_id
    where n.organization_id = p_organization_id
      and bc.parent_id is null
      and bc.status = 'active'
      and (p_pauta_id is null or n.id = p_pauta_id)
  ),
  scoped as (
    select nm.*
    from narrative_metrics nm
    join root_narratives rn on rn.narrative_id = nm.narrative_id
    where nm.period = 'daily'
      and nm.metric_date between p_period_start and p_period_end
  ),
  per_pauta as (
    select
      rn.narrative_id,
      rn.title,
      sum(s.total_mentions) as total_mentions,
      sum(s.net_sentiment * s.total_mentions) filter (where s.net_sentiment is not null) as weighted,
      sum(s.total_mentions) filter (where s.net_sentiment is not null) as weight
    from root_narratives rn
    left join scoped s on s.narrative_id = rn.narrative_id
    group by rn.narrative_id, rn.title
  ),
  grand_total as (
    select sum(total_mentions) as total from per_pauta
  )
  select
    title as label,
    round(weighted / nullif(weight, 0), 1) as value,
    round(coalesce(total_mentions, 0) * 100.0 / nullif((select total from grand_total), 0), 1) as pct
  from per_pauta
$$;
