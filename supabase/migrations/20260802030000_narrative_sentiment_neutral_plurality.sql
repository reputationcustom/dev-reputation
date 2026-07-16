-- Bug real reportado pelo usuário via screenshot (2026-07-14): borda/rótulo
-- do card de Narrativa ("Direita"/"Esquerda") mostravam "Negativo -20"/
-- "Negativo -29", contradizendo a própria barra pos/neu/neg do mesmo card
-- (Direita: pos 22.3% / neu 44.2% / neg 33.5% — neutro é a MAIORIA;
-- Esquerda: pos 18.5% / neu 47.7% / neg 33.8% — neutro também é maioria).
-- A tabela "Todas as Narrativas" mostra o mesmo valor (mesma function),
-- então não é uma nova divergência card-vs-tabela — os dois já lêem a
-- mesma coluna. O problema é que o valor em si não reflete o que a
-- própria barra do card mostra ao lado.
--
-- Causa raiz: `net_sentiment`/`sentiment_label` (get_narratives_table,
-- desde a correção 20260726020000/consolidada em 20260731040000) são
-- calculados como (positivo - negativo) / (positivo + negativo) * 100 —
-- um "net sentiment entre mentions classificadas", que IGNORA
-- completamente o volume de menções neutras no denominador. Conferido
-- contra os números reais do screenshot: Direita (22.3-33.5)/(22.3+33.5)*100
-- = -20.07 → "Negativo -20"; Esquerda (18.5-33.8)/(18.5+33.8)*100 = -29.25
-- → "Negativo -29" — bate exatamente com o que a tabela mostra. Ou seja, a
-- fórmula está funcionando exatamente como projetada — só que "projetada"
-- nunca considerou o caso em que Neutro é a maioria clara: uma pequena
-- diferença entre duas MINORIAS (positivo e negativo) acaba decidindo o
-- rótulo inteiro, mesmo quando a maior parte do volume não tem sinal
-- algum. Não é o mesmo bug já corrigido em 20260720000000 (fórmula antiga
-- diluída por total_mentions, que mascarava um skew real) nem em
-- 20260725060000/20260726020000 (duas fontes divergentes pro mesmo dado) —
-- é um terceiro problema, novo: a fórmula nunca checou qual dos 3 baldes
-- (positivo/neutro/negativo) é de fato o predominante antes de rotular.
--
-- Fix: `sentiment_label` (e o `net_sentiment` mostrado ao lado, pra não
-- ficar "Neutro -20" contraditório) passam a checar primeiro se Neutro é
-- o balde predominante (>= positivo E >= negativo, com pelo menos alguma
-- menção neutra) — se for, o rótulo é sempre 'neutral' e o score
-- reportado é 0, independente do skew entre positivo/negativo. Só quando
-- Neutro NÃO é predominante o score de skew (positivo-negativo)/
-- (positivo+negativo) volta a decidir o rótulo pelas 7 faixas de sempre.
-- `risk_inputs.sentiment_risk` herda a correção automaticamente (lê
-- `sl.net_sentiment`), sem mudança própria — um net_sentiment=0 correto
-- pra uma Narrativa dominada por cobertura neutra já produz o
-- `sentiment_risk` neutro esperado (50, nem baixo nem alto), em vez de
-- inflar o risco por causa de uma minoria de menções levemente
-- desbalanceada.
--
-- Mesma assinatura/mesmas colunas de saída de 20260731040000 — só o corpo
-- das CTEs `sentiment_final`/`sentiment_labeled` muda, `create or
-- replace` basta (sem `drop function`).
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
  -- ✅ 20260802030000: carrega os 3 baldes crus junto com o skew, pra
  -- `sentiment_labeled` decidir se Neutro é o balde predominante antes de
  -- aplicar o skew positivo/negativo.
  sentiment_final as (
    select
      narrative_id,
      sentiment_positive_current,
      sentiment_neutral_current,
      sentiment_negative_current,
      case
        when coalesce(sentiment_positive_current, 0) + coalesce(sentiment_negative_current, 0) > 0
          then (sentiment_positive_current - sentiment_negative_current)::numeric * 100.0
               / (sentiment_positive_current + sentiment_negative_current)
      end as net_sentiment_skew
    from period_agg
  ),
  -- ✅ 20260802030000: quando Neutro é o balde predominante (>= positivo E
  -- >= negativo, com alguma menção neutra de fato), o rótulo é sempre
  -- 'neutral' e o score reportado é 0 — nunca deixa uma pequena diferença
  -- entre positivo/negativo (as duas minorias) decidir o rótulo quando a
  -- maior parte da cobertura não tem sinal nenhum. Só quando Neutro NÃO é
  -- predominante o skew positivo/negativo volta a valer, nas mesmas 7
  -- faixas de sempre.
  sentiment_labeled as (
    select
      narrative_id,
      case
        when coalesce(sentiment_neutral_current, 0) > 0
         and coalesce(sentiment_neutral_current, 0) >= coalesce(sentiment_positive_current, 0)
         and coalesce(sentiment_neutral_current, 0) >= coalesce(sentiment_negative_current, 0)
          then 0
        else net_sentiment_skew
      end as net_sentiment,
      case
        when coalesce(sentiment_neutral_current, 0) > 0
         and coalesce(sentiment_neutral_current, 0) >= coalesce(sentiment_positive_current, 0)
         and coalesce(sentiment_neutral_current, 0) >= coalesce(sentiment_negative_current, 0)
          then 'neutral'
        when net_sentiment_skew >= 50 then 'very_positive'
        when net_sentiment_skew >= 20 then 'positive'
        when net_sentiment_skew >= 5 then 'slightly_positive'
        when net_sentiment_skew >= -4 then 'neutral'
        when net_sentiment_skew >= -19 then 'slightly_negative'
        when net_sentiment_skew >= -49 then 'negative'
        when net_sentiment_skew is not null then 'very_negative'
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
  'Bloco `narratives` do envelope. ÚNICO overload desta function (20260731040000 consolidou dois overloads conflitantes que causavam narratives:[] via PostgREST). p_scope: null = sem filtro extra, ''roots'' = só Category de topo, ''leaves'' = só Subcategory de qualquer Category, ''pautas'' = só Subcategory cuja Category-pai é a Category raiz "Pautas". p_reference_at (default now()): ancora o cálculo de Tendência (regressão de 14 dias) numa data específica — usado por get_communication_impact. risk_score tem um termo de interação: a contribuição conjunta de momentum_score+trend_score é amortecida (piso 50%) quando sentiment_risk é baixo. net_sentiment/sentiment_label (correção 20260802030000): quando o balde Neutro é predominante (>= positivo e >= negativo), o rótulo é sempre ''neutral'' e o score reportado é 0 — nunca deixa uma diferença pequena entre as MINORIAS positivo/negativo decidir o rótulo quando a maioria das menções não tem sinal algum; só quando Neutro não é predominante o skew (positivo-negativo)/(positivo+negativo) decide o rótulo nas 7 faixas de sempre. category_label = nome da Category-pai de bw_categories; para uma linha de escopo ''roots'' (sem pai), cai no próprio nome da Category.';
