-- Módulo `communications` (Sprint 2.1) — .dev/specs/communications/
-- narrative-impact-tracking.md.
--
-- 1) Extensão aditiva em get_narratives_table: novo parâmetro opcional
--    `p_reference_at timestamptz default now()`, usado só pelo cálculo de
--    Tendência (antes sempre ancorado em `current_date`) — permite calcular
--    Momentum/Tendência/Risco/Sentimento "como estavam" numa data histórica
--    (antes/depois de uma Comunicação/Decisão), não só "agora". Nenhum
--    consumidor existente passa esse parâmetro, então o comportamento das 5
--    páginas de intelligence-center fica inalterado (herdam o default).
--
--    ⚠️ Muda a aridade da function (6 → 7 parâmetros) — `create or replace`
--    sozinho criaria um novo overload em vez de substituir (mesmo bug real
--    já documentado em CLAUDE.md, "Narrative card redesign...", pra esta
--    mesma function em 2026-07-21). Precisa de `drop function` explícito
--    pela assinatura antiga antes de recriar.
--
-- 2) get_communication_impact / get_narrative_communication_timeline —
--    consomem get_narratives_table (via p_reference_at) + narrative_metrics
--    pra responder as 4 perguntas do acompanhamento pós-comunicação/decisão
--    (sentimento/menções/risco/momentum antes vs. depois).

drop function if exists get_narratives_table(uuid, date, date, jsonb, uuid, text);

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
    select n.id, n.bw_category_id, n.description
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
      sum(sentiment_negative) filter (where metric_date between p_period_start and p_period_end) as sentiment_negative_current,
      sum(net_sentiment * total_mentions) filter (where net_sentiment is not null and metric_date between p_period_start and p_period_end) as net_sentiment_weighted,
      sum(total_mentions) filter (where net_sentiment is not null and metric_date between p_period_start and p_period_end) as net_sentiment_weight
    from narrative_metrics
    where period = 'daily'
      and narrative_id in (select id from scope)
      and metric_date between (select prev_start from prev_range) and p_period_end
    group by narrative_id
  ),
  sentiment_final as (
    select
      narrative_id,
      coalesce(
        case when coalesce(net_sentiment_weight, 0) > 0 then net_sentiment_weighted / net_sentiment_weight end,
        case
          when coalesce(sentiment_positive_current, 0) + coalesce(sentiment_negative_current, 0) > 0
            then (sentiment_positive_current - sentiment_negative_current)::numeric * 100.0
                 / (sentiment_positive_current + sentiment_negative_current)
        end
      ) as net_sentiment
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
  -- ✅ 20260726010000: usa p_reference_at (default now()) em vez de
  -- current_date hardcoded — permite ancorar a janela de 14 dias da
  -- Tendência numa data histórica (ver comunications/narrative-impact-tracking.md).
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
  risk as (
    select
      narrative_id,
      round(
        0.25 * sentiment_risk +
        least(1, greatest(0.5, sentiment_risk / 50.0)) * (
          0.25 * coalesce(momentum_score, 50) +
          0.20 * coalesce(trend_score, 50)
        ) +
        0.15 * coalesce(reach_risk, 0) +
        0.10 * author_influence +
        0.05 * coalesce(impact_risk, 0)
      ) as risk_score
    from risk_inputs
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
  'Bloco `narratives` do envelope. p_scope: null = sem filtro extra, ''roots'' = só Category de topo, ''leaves'' = só Subcategory de qualquer Category, ''pautas'' = só Subcategory cuja Category-pai é a Category raiz "Pautas". p_reference_at (migration 20260726010000, default now()): ancora o cálculo de Tendência (regressão de 14 dias) numa data específica em vez de sempre "agora" — usado por get_communication_impact para reconstruir Tendência histórica antes/depois de uma Comunicação/Decisão. Nenhum consumidor de página passa esse parâmetro, então o comportamento de intelligence-center é inalterado.';

-- =========================================================================
-- get_communication_impact — para um registro (Comunicação ou Decisão),
-- compara uma janela antes/depois de `occurred_at` nas 4 métricas pedidas
-- (Sentimento/Menções/Risco/Momentum), reaproveitando get_narratives_table
-- (nunca recalculando as fórmulas). Ver
-- .dev/specs/communications/narrative-impact-tracking.md.
-- =========================================================================

create or replace function get_communication_impact(
  p_communication_id uuid,
  p_window_days integer default 7
)
returns table (
  communication_id uuid,
  narrative_id uuid,
  record_type communication_record_type,
  occurred_at timestamptz,
  before_start date,
  before_end date,
  after_start date,
  after_end date,
  after_window_complete boolean,
  mentions_per_day_before numeric,
  mentions_per_day_after numeric,
  mentions_delta_pct numeric,
  net_sentiment_before numeric,
  net_sentiment_after numeric,
  sentiment_label_before text,
  sentiment_label_after text,
  momentum_score_before numeric,
  momentum_score_after numeric,
  risk_score_before numeric,
  risk_score_after numeric,
  risk_label_before text,
  risk_label_after text,
  trend_score_before numeric,
  trend_score_after numeric,
  trend_label_before text,
  trend_label_after text
)
language sql
stable
set search_path = public
as $$
  with windows as (
    select
      c.id,
      c.narrative_id,
      c.record_type,
      c.occurred_at,
      c.organization_id,
      (c.occurred_at::date - p_window_days) as before_start,
      (c.occurred_at::date - 1) as before_end,
      c.occurred_at::date as after_start,
      least(c.occurred_at::date + (p_window_days - 1), current_date) as after_end,
      ((c.occurred_at::date + (p_window_days - 1)) <= current_date) as after_window_complete,
      least(c.occurred_at + make_interval(days => p_window_days), now()) as after_reference_at
    from communications c
    where c.id = p_communication_id
  ),
  mentions_before as (
    select w.id, avg(nm.total_mentions) as avg_mentions
    from windows w
    left join narrative_metrics nm
      on nm.narrative_id = w.narrative_id
      and nm.period = 'daily'
      and nm.metric_date between w.before_start and w.before_end
    group by w.id
  ),
  mentions_after as (
    select w.id, avg(nm.total_mentions) as avg_mentions
    from windows w
    left join narrative_metrics nm
      on nm.narrative_id = w.narrative_id
      and nm.period = 'daily'
      and nm.metric_date between w.after_start and w.after_end
    group by w.id
  ),
  -- ⚠️ Bug real corrigido (2026-07-26, achado via `supabase db push`):
  -- `select w.id, gnt.*` trazia DUAS colunas chamadas `id` pra dentro desta
  -- CTE — `w.id` (id da comunicação/decisão) e `gnt.id` (id da Narrativa,
  -- primeira coluna de retorno de `get_narratives_table`) — o que tornava
  -- `bs.id`/`af.id` ambíguos lá embaixo (`ERROR: column reference "id" is
  -- ambiguous`, SQLSTATE 42702). Corrigido listando explicitamente só as
  -- colunas de `gnt` realmente usadas (nunca `gnt.id`/`title`/`sov_pct`/etc,
  -- que esta function não consome de qualquer forma).
  before_scores as (
    select
      w.id,
      gnt.net_sentiment,
      gnt.sentiment_label,
      gnt.momentum_score,
      gnt.trend_score,
      gnt.trend_label,
      gnt.risk_score,
      gnt.risk_label
    from windows w
    left join lateral get_narratives_table(
      p_organization_id => w.organization_id,
      p_period_start => w.before_start,
      p_period_end => w.before_end,
      p_filters => jsonb_build_object('narratives', jsonb_build_array(w.narrative_id)),
      p_reference_at => w.occurred_at
    ) gnt on true
  ),
  after_scores as (
    select
      w.id,
      gnt.net_sentiment,
      gnt.sentiment_label,
      gnt.momentum_score,
      gnt.trend_score,
      gnt.trend_label,
      gnt.risk_score,
      gnt.risk_label
    from windows w
    left join lateral get_narratives_table(
      p_organization_id => w.organization_id,
      p_period_start => w.after_start,
      p_period_end => w.after_end,
      p_filters => jsonb_build_object('narratives', jsonb_build_array(w.narrative_id)),
      p_reference_at => w.after_reference_at
    ) gnt on true
  )
  select
    w.id as communication_id,
    w.narrative_id,
    w.record_type,
    w.occurred_at,
    w.before_start,
    w.before_end,
    w.after_start,
    w.after_end,
    w.after_window_complete,
    mb.avg_mentions as mentions_per_day_before,
    ma.avg_mentions as mentions_per_day_after,
    case
      when coalesce(mb.avg_mentions, 0) = 0 then null
      else round((ma.avg_mentions - mb.avg_mentions) / mb.avg_mentions * 100, 1)
    end as mentions_delta_pct,
    bs.net_sentiment as net_sentiment_before,
    af.net_sentiment as net_sentiment_after,
    bs.sentiment_label as sentiment_label_before,
    af.sentiment_label as sentiment_label_after,
    bs.momentum_score as momentum_score_before,
    af.momentum_score as momentum_score_after,
    bs.risk_score as risk_score_before,
    af.risk_score as risk_score_after,
    bs.risk_label as risk_label_before,
    af.risk_label as risk_label_after,
    bs.trend_score as trend_score_before,
    af.trend_score as trend_score_after,
    bs.trend_label as trend_label_before,
    af.trend_label as trend_label_after
  from windows w
  left join mentions_before mb on mb.id = w.id
  left join mentions_after ma on ma.id = w.id
  left join before_scores bs on bs.id = w.id
  left join after_scores af on af.id = w.id
$$;

comment on function get_communication_impact(uuid, integer) is
  'Compara as janelas antes/depois de communications.occurred_at (Comunicação ou Decisão) nas 4 métricas do acompanhamento pós-comunicação/decisão — mentions_per_day via avg direto de narrative_metrics, as demais via get_narratives_table(p_reference_at). Correlação, não causalidade — ver .dev/specs/communications/narrative-impact-tracking.md, "Regras de negócio".';

-- =========================================================================
-- get_narrative_communication_timeline — todos os registros de uma
-- Narrativa, ordenados cronologicamente, cada um com seu get_communication_impact
-- já calculado — alimenta a linha do tempo de /communications/[narrativeId]
-- e o resumo compacto no detalhe de Narrativa.
-- =========================================================================

create or replace function get_narrative_communication_timeline(
  p_narrative_id uuid,
  p_organization_id uuid,
  p_window_days integer default 7
)
returns table (
  communication_id uuid,
  narrative_id uuid,
  record_type communication_record_type,
  occurred_at timestamptz,
  title text,
  communication_type_label text,
  channel_detail text,
  before_start date,
  before_end date,
  after_start date,
  after_end date,
  after_window_complete boolean,
  mentions_per_day_before numeric,
  mentions_per_day_after numeric,
  mentions_delta_pct numeric,
  net_sentiment_before numeric,
  net_sentiment_after numeric,
  sentiment_label_before text,
  sentiment_label_after text,
  momentum_score_before numeric,
  momentum_score_after numeric,
  risk_score_before numeric,
  risk_score_after numeric,
  risk_label_before text,
  risk_label_after text,
  trend_score_before numeric,
  trend_score_after numeric,
  trend_label_before text,
  trend_label_after text
)
language sql
stable
set search_path = public
as $$
  select
    gci.communication_id,
    gci.narrative_id,
    gci.record_type,
    gci.occurred_at,
    c.title,
    ct.label as communication_type_label,
    c.channel_detail,
    gci.before_start,
    gci.before_end,
    gci.after_start,
    gci.after_end,
    gci.after_window_complete,
    gci.mentions_per_day_before,
    gci.mentions_per_day_after,
    gci.mentions_delta_pct,
    gci.net_sentiment_before,
    gci.net_sentiment_after,
    gci.sentiment_label_before,
    gci.sentiment_label_after,
    gci.momentum_score_before,
    gci.momentum_score_after,
    gci.risk_score_before,
    gci.risk_score_after,
    gci.risk_label_before,
    gci.risk_label_after,
    gci.trend_score_before,
    gci.trend_score_after,
    gci.trend_label_before,
    gci.trend_label_after
  from communications c
  left join communication_types ct on ct.id = c.communication_type_id
  cross join lateral get_communication_impact(c.id, p_window_days) gci
  where c.narrative_id = p_narrative_id
    and c.organization_id = p_organization_id
  order by c.occurred_at asc
$$;

comment on function get_narrative_communication_timeline(uuid, uuid, integer) is
  'Linha do tempo completa (Comunicações + Decisões) de uma Narrativa, cada registro já com seu get_communication_impact calculado — alimenta /communications/[narrativeId] e o resumo "Comunicações e Decisões" do detalhe de Narrativa.';
