-- Módulo: aggregated-metrics / foundation
-- Pedido do usuário (2026-07-21): redesenhar os cards de Narrativa (lista
-- de Narrativas, "Top 3 Narrativas" da Visão Geral) seguindo uma referência
-- visual anexada — borda esquerda colorida pelo sentimento, SOV + menções
-- em destaque, barra de risco, texto de resumo (reservado pra IA,
-- ai-synthesis, sprint futura), barra de sentimento positivo/neutro/
-- negativo, e tags. get_narratives_table precisa devolver todo esse dado —
-- hoje só tinha sov/momentum/velocity/risk/net_sentiment agregado, faltava
-- o split completo de sentimento, o texto reservado e as tags.
--
-- Fontes, nenhuma inventada (Princípio técnico 2 — nunca calcular/agregar
-- localmente sobre `mentions`):
-- - sentiment_positive_pct/neutral_pct/negative_pct: soma de
--   narrative_metrics.sentiment_positive/neutral/negative no período
--   pedido, normalizado por (pos+neu+neg) — mesma definição já usada por
--   get_narrative_sentiment_breakdown (20260717000000) e pelo fallback de
--   sentiment_bucket corrigido em 20260720000000. NUNCA divide pelo total
--   de mentions (dilui o resultado, mesmo bug já corrigido nessas duas
--   migrations).
-- - summary: narratives.description — campo já reservado desde
--   foundation/narratives.md ("Resumo executivo"), sem produtor ainda
--   (ai-synthesis não implementado). Hoje sempre null; o frontend já
--   precisa estar preparado para recebê-lo quando essa sprint futura
--   popular a coluna.
-- - tags: top termos de bw_query_topics (topic_type in
--   'hashtags'/'phrases'/'words') por Narrativa, na semana mais recente
--   sincronizada para aquela Category/Subcategory — agregado oficial já
--   existente (foundation, "Novos aggregate tables"), nunca amostrado.
--   ⚠️ Não inclui um marcador de "emoção" — bw_query_topics não tem essa
--   dimensão (extract= não cobre emoção) e mentions.emotion é um sinal
--   por mention, best-effort e dependente da premissa de "nunca
--   agregar sobre mentions amostradas" (ver CLAUDE.md/foundation/
--   data-model.md) — não existe fonte não-amostrada pra "emoção
--   dominante da Narrativa" hoje. Se o produto quiser esse chip, é
--   candidato natural pra sair do `summary`/ai-synthesis (classificação
--   feita pela IA sobre o conjunto já sincronizado), não um cálculo local
--   novo aqui.
--
-- Precisa dropar a function (não só `create or replace`) porque estamos
-- adicionando colunas de saída — mesma trava do Postgres já documentada em
-- 20260717000000 (`cannot change return type of existing function`).

drop function if exists get_narratives_table(uuid, date, date, jsonb, uuid, text);

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
  sentiment_positive_pct numeric,
  sentiment_neutral_pct numeric,
  sentiment_negative_pct numeric,
  momentum_score numeric,
  velocity_score numeric,
  velocity_label text,
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
    ld.net_sentiment,
    ld.sentiment_bucket as sentiment_label,
    round(coalesce(pa.sentiment_positive_current, 0) * 100.0 / nullif(coalesce(pa.sentiment_positive_current, 0) + coalesce(pa.sentiment_neutral_current, 0) + coalesce(pa.sentiment_negative_current, 0), 0), 1) as sentiment_positive_pct,
    round(coalesce(pa.sentiment_neutral_current, 0) * 100.0 / nullif(coalesce(pa.sentiment_positive_current, 0) + coalesce(pa.sentiment_neutral_current, 0) + coalesce(pa.sentiment_negative_current, 0), 0), 1) as sentiment_neutral_pct,
    round(coalesce(pa.sentiment_negative_current, 0) * 100.0 / nullif(coalesce(pa.sentiment_positive_current, 0) + coalesce(pa.sentiment_neutral_current, 0) + coalesce(pa.sentiment_negative_current, 0), 0), 1) as sentiment_negative_pct,
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
    end as risk_label,
    s.description as summary,
    coalesce(tc.tags, '{}') as tags
  from latest_day ld
  join scope s on s.id = ld.narrative_id
  left join period_agg pa on pa.narrative_id = ld.narrative_id
  left join momentum m on m.narrative_id = ld.narrative_id
  left join velocity v on v.narrative_id = ld.narrative_id
  left join risk r on r.narrative_id = ld.narrative_id
  left join tags_by_category tc on tc.category_id = s.bw_category_id
  order by r.risk_score desc nulls last, ld.total_mentions desc nulls last
$$;

comment on function get_narratives_table is
  'Bloco `narratives` do envelope (aggregated-metrics/sql-aggregation.md). sentiment_positive_pct/neutral_pct/negative_pct = split de narrative_metrics.sentiment_* normalizado por (pos+neu+neg) no período pedido (mesma base de get_narrative_sentiment_breakdown, nunca dilui pelo total de mentions). summary = narratives.description (reservado pra ai-synthesis, hoje sempre null). tags = top 6 termos/hashtags de bw_query_topics por Narrativa (agregado oficial, nunca amostrado) — ver CLAUDE.md, "Sentimento por narrativa/autores" e "Narrative naming/scope change".';
