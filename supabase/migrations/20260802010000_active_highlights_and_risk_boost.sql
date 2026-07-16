-- event-radar/fluxo-aggregated-metrics.md, "Fase B" (A1 + A2) — implementado
-- a pedido do usuário ("Sim, vamos prosseguir com a fase b"), depois que o
-- pré-requisito (event-radar publicando feed_events) foi confirmado
-- satisfeito (ver 20260802000000 e _pending.md gap #8).
--
-- A1: get_active_highlights(...) — bloco `highlights` do envelope
-- (sql-aggregation.md). Leitura pura de feed_events, sem cálculo — nunca
-- reimplementa as regras de detecção do radar (z-score, variação %, janelas
-- de comparação), mesma regra já registrada em "Regras de negócio" da spec.
--
-- A2: get_narratives_table ganha o boost de risk_score a partir de
-- feed_events ativos (create or replace only — não muda a assinatura nem a
-- lista de colunas de saída, então não precisa de drop function). Fonte
-- exata, per sql-aggregation.md "Risco" (nota de 2026-08-02): MAX(severity_score)
-- entre feed_events com related_narrative_id = narrativa e closed_at is null
-- — nunca radar_staging_events diretamente (um evento com should_publish=false
-- nunca chegou a feed_events, não deve contar).

-- =========================================================================
-- A1: get_active_highlights
-- =========================================================================

create or replace function get_active_highlights(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  event_type text,
  severity severity_level,
  severity_score numeric,
  title text,
  summary text,
  explanation text,
  recommendation text,
  confidence numeric,
  tags text[],
  related_narrative_id uuid,
  related_entity_id uuid
)
language sql
stable
set search_path = public
as $$
  with narrative_ids as (
    select nullif(array_agg((elem)::uuid), '{}') as ids
    from jsonb_array_elements_text(coalesce(p_filters -> 'narratives', '[]'::jsonb)) as elem
  )
  select
    fe.event_type,
    fe.severity,
    fe.severity_score,
    fe.title,
    fe.summary,
    fe.description as explanation,
    fe.recommendation,
    fe.confidence,
    coalesce(fe.tags, '{}'),
    fe.related_narrative_id,
    fe.related_entity_id
  from feed_events fe
  cross join narrative_ids
  where fe.organization_id = p_organization_id
    and fe.created_at::date between p_period_start and p_period_end
    and (narrative_ids.ids is null or fe.related_narrative_id = any(narrative_ids.ids))
  order by fe.severity_score desc nulls last, fe.created_at desc
  limit 30
$$;

comment on function get_active_highlights(uuid, date, date, jsonb) is
  'Bloco `highlights` do envelope (sql-aggregation.md, A1 de event-radar/fluxo-aggregated-metrics.md "Fase B"). Leitura pura de feed_events — nunca recalcula severidade/detecção (essa lógica pertence só ao event-radar). Escopo: organization_id sempre; filters.narratives (quando presente) restringe a related_narrative_id — único filtro de EnvelopeFilters realmente aplicado hoje, mesmo padrão de toda outra function deste módulo. period_start/period_end filtram por feed_events.created_at (data de publicação do card, não a janela de detecção do evento). Sem filtro de closed_at de propósito — um evento fechado dentro do período pedido ainda é um insight relevante pra quem está olhando aquele período; "ativo" (closed_at is null) só importa pro boost de risk_score em get_narratives_table (A2), não pra este bloco de listagem. Limit 30: o cap diário de 15 eventos/organização (event-radar 1.6) já bounda o volume por dia, este limite é só uma salvaguarda de payload pra períodos multi-dia.';

-- =========================================================================
-- A2: get_narratives_table — boost de risk_score a partir de feed_events
-- ativos. create or replace: mesma assinatura (7 parâmetros) e mesma lista
-- de colunas de saída da versão anterior (20260731040000) — só o cálculo
-- interno de risk_score muda, então não precisa de drop function.
-- =========================================================================

create or replace function get_narratives_table(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb,
  p_pauta_id uuid default null,
  p_scope text default null,
  p_reference_at timestamptz default now()
)
returns table (
  id uuid,
  title text,
  category_label text,
  sov_pct numeric,
  total_mentions integer,
  net_sentiment numeric,
  sentiment_label text,
  sentiment_positive_pct numeric,
  sentiment_neutral_pct numeric,
  sentiment_negative_pct numeric,
  momentum_score numeric,
  trend_score numeric,
  trend_label text,
  risk_score numeric,
  risk_label text,
  summary text,
  tags text[]
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
    select
      n.id,
      n.bw_category_id,
      n.description,
      coalesce(parent_bc.name, bc.name) as category_label
    from narratives n
    join bw_categories bc on bc.id = n.bw_category_id
    left join bw_categories parent_bc on parent_bc.id = bc.parent_id
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
            or (p_scope = 'pautas' and bc.parent_id = pautas_root_category_id(p_organization_id))
          )
        )
      )
      and (narrative_ids.ids is null or n.id = any(narrative_ids.ids))
  ),
  latest_day as (
    select distinct on (nv.narrative_id)
      nv.narrative_id, nv.title, nv.sov_percent, nv.total_mentions, nm.query_id
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
      sum(reach_estimated) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as reach_previous,
      sum(sentiment_positive) filter (where metric_date between p_period_start and p_period_end) as sentiment_positive_current,
      sum(sentiment_neutral) filter (where metric_date between p_period_start and p_period_end) as sentiment_neutral_current,
      sum(sentiment_negative) filter (where metric_date between p_period_start and p_period_end) as sentiment_negative_current
    from narrative_metrics
    where period = 'daily'
      and narrative_id in (select id from scope)
      and metric_date between (select prev_start from prev_range) and p_period_end
    group by narrative_id
  ),
  sentiment_final as (
    select
      narrative_id,
      case
        when coalesce(sentiment_positive_current, 0) + coalesce(sentiment_negative_current, 0) > 0
          then (sentiment_positive_current - sentiment_negative_current)::numeric * 100.0
               / (sentiment_positive_current + sentiment_negative_current)
      end as net_sentiment
    from period_agg
  ),
  sentiment_labeled as (
    select
      narrative_id,
      net_sentiment,
      case
        when net_sentiment >= 50 then 'very_positive'
        when net_sentiment >= 20 then 'positive'
        when net_sentiment >= 5 then 'slightly_positive'
        when net_sentiment >= -4 then 'neutral'
        when net_sentiment >= -19 then 'slightly_negative'
        when net_sentiment >= -49 then 'negative'
        when net_sentiment is not null then 'very_negative'
        else 'neutral'
      end as sentiment_label
    from sentiment_final
  ),
  trend_series as (
    select
      s.id as narrative_id,
      nm.total_mentions,
      row_number() over (partition by s.id order by nm.metric_date) as day_index
    from scope s
    join narrative_metrics nm
      on nm.narrative_id = s.id
      and nm.period = 'daily'
      and nm.metric_date >= (p_reference_at::date) - interval '13 days'
      and nm.metric_date <= (p_reference_at::date)
  ),
  trend_agg as (
    select
      narrative_id,
      regr_slope(total_mentions::double precision, day_index::double precision) as slope_per_day,
      avg(total_mentions) as avg_mentions,
      count(*) as n_points
    from trend_series
    group by narrative_id
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
  trend as (
    select
      ld.narrative_id,
      case
        when ta.n_points is null or ta.n_points < 4 or coalesce(ta.avg_mentions, 0) = 0 then null
        else greatest(0, least(100,
          50 + greatest(least((ta.slope_per_day * ta.n_points) / ta.avg_mentions, 1), -1) * 50
        ))
      end as trend_score
    from latest_day ld
    left join trend_agg ta on ta.narrative_id = ld.narrative_id
  ),
  risk_inputs as (
    select
      ld.narrative_id,
      greatest(0, least(100, (100 - coalesce(sl.net_sentiment, 0)) / 2.0)) as sentiment_risk,
      m.momentum_score,
      t.trend_score,
      coalesce(pa.reach_current, 0) * 100.0 / nullif(max(coalesce(pa.reach_current, 0)) over (partition by ld.query_id), 0) as reach_risk,
      coalesce(pa.engagement_current, 0) * 100.0 / nullif(max(coalesce(pa.engagement_current, 0)) over (partition by ld.query_id), 0) as impact_risk,
      coalesce(ai.author_influence, 0) as author_influence
    from latest_day ld
    left join sentiment_labeled sl on sl.narrative_id = ld.narrative_id
    left join period_agg pa on pa.narrative_id = ld.narrative_id
    left join momentum m on m.narrative_id = ld.narrative_id
    left join trend t on t.narrative_id = ld.narrative_id
    left join author_influence_agg ai on ai.narrative_id = ld.narrative_id
  ),
  -- A2 (event-radar/fluxo-aggregated-metrics.md "Fase B"): MAX(severity_score)
  -- entre feed_events ativos (closed_at is null) da Narrativa. Nunca
  -- radar_staging_events direto — um evento com should_publish=false nunca
  -- vira feed_events, não deve contar pro boost (ver sql-aggregation.md,
  -- "Risco", nota de 2026-08-02). MAX, não soma: uma Narrativa pode ter mais
  -- de um evento ativo simultâneo (ex: um de volume e um de sentimento).
  radar_boost as (
    select
      related_narrative_id as narrative_id,
      max(severity_score) as severity_score
    from feed_events
    where organization_id = p_organization_id
      and related_narrative_id is not null
      and closed_at is null
    group by related_narrative_id
  ),
  risk as (
    select
      ri.narrative_id,
      -- Boost aditivo: um evento detectado só pode ELEVAR o risco mostrado,
      -- nunca derrubá-lo (greatest, não uma média/soma).
      greatest(
        round(
          0.25 * ri.sentiment_risk +
          least(1, greatest(0.5, ri.sentiment_risk / 50.0)) * (
            0.25 * coalesce(ri.momentum_score, 50) +
            0.20 * coalesce(ri.trend_score, 50)
          ) +
          0.15 * coalesce(ri.reach_risk, 0) +
          0.10 * ri.author_influence +
          0.05 * coalesce(ri.impact_risk, 0)
        ),
        coalesce(rb.severity_score, 0)
      ) as risk_score
    from risk_inputs ri
    left join radar_boost rb on rb.narrative_id = ri.narrative_id
  ),
  tag_latest_week as (
    select bqt.category_id, max(bqt.metric_week) as w
    from bw_query_topics bqt
    where bqt.category_id in (select bw_category_id from scope)
      and bqt.topic_type in ('hashtags', 'phrases', 'words')
    group by bqt.category_id
  ),
  tag_ranked as (
    select
      t.category_id,
      t.label,
      row_number() over (partition by t.category_id order by t.volume desc nulls last) as rn
    from bw_query_topics t
    join tag_latest_week lw on lw.category_id = t.category_id and lw.w = t.metric_week
    where t.topic_type in ('hashtags', 'phrases', 'words')
  ),
  tags_by_category as (
    select category_id, array_agg(label order by rn) as tags
    from tag_ranked
    where rn <= 6
    group by category_id
  )
  select
    ld.narrative_id as id,
    ld.title,
    s.category_label,
    ld.sov_percent as sov_pct,
    ld.total_mentions,
    sl.net_sentiment,
    sl.sentiment_label,
    round(coalesce(pa.sentiment_positive_current, 0) * 100.0 / nullif(coalesce(pa.sentiment_positive_current, 0) + coalesce(pa.sentiment_neutral_current, 0) + coalesce(pa.sentiment_negative_current, 0), 0), 1) as sentiment_positive_pct,
    round(coalesce(pa.sentiment_neutral_current, 0) * 100.0 / nullif(coalesce(pa.sentiment_positive_current, 0) + coalesce(pa.sentiment_neutral_current, 0) + coalesce(pa.sentiment_negative_current, 0), 0), 1) as sentiment_neutral_pct,
    round(coalesce(pa.sentiment_negative_current, 0) * 100.0 / nullif(coalesce(pa.sentiment_positive_current, 0) + coalesce(pa.sentiment_neutral_current, 0) + coalesce(pa.sentiment_negative_current, 0), 0), 1) as sentiment_negative_pct,
    m.momentum_score,
    t.trend_score,
    case
      when t.trend_score is null then null
      when t.trend_score < 40 then 'decreasing'
      when t.trend_score < 60 then 'stable'
      else 'increasing'
    end as trend_label,
    r.risk_score,
    case
      when r.risk_score is null then null
      when r.risk_score < 34 then 'low'
      when r.risk_score < 60 then 'medium'
      when r.risk_score < 85 then 'high'
      else 'critical'
    end as risk_label,
    s.description as summary,
    coalesce(tc.tags, '{}') as tags
  from latest_day ld
  join scope s on s.id = ld.narrative_id
  left join sentiment_labeled sl on sl.narrative_id = ld.narrative_id
  left join period_agg pa on pa.narrative_id = ld.narrative_id
  left join momentum m on m.narrative_id = ld.narrative_id
  left join trend t on t.narrative_id = ld.narrative_id
  left join risk r on r.narrative_id = ld.narrative_id
  left join tags_by_category tc on tc.category_id = s.bw_category_id
  order by r.risk_score desc nulls last, ld.total_mentions desc nulls last
$$;

comment on function get_narratives_table(uuid, date, date, jsonb, uuid, text, timestamptz) is
  'Bloco `narratives` do envelope. ÚNICO overload desta function (migration 20260731040000 consolidou dois overloads conflitantes). p_scope: null = sem filtro extra, ''roots'' = só Category de topo, ''leaves'' = só Subcategory de qualquer Category, ''pautas'' = só Subcategory cuja Category-pai é a Category raiz "Pautas". p_reference_at (default now()): ancora o cálculo de Tendência numa data específica — usado por get_communication_impact. risk_score = greatest(fórmula composta de sentimento+momentum+tendência+alcance+influência+impacto, MAX(feed_events.severity_score) entre eventos ativos da Narrativa) — event-radar (A2, 20260802010000) só pode ELEVAR o risco mostrado, nunca derrubá-lo. net_sentiment/sentiment_label vêm SEMPRE do cálculo local sobre sentiment_positive_pct/neutral_pct/negative_pct do período. category_label = nome da Category-pai de bw_categories.';
