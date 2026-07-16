-- Resolve a decisão #3 de _pending.md (aggregated-metrics/sql-aggregation.md,
-- "Scores de Narrativa" — ⚠️ DECISÃO PENDENTE original): risk_score somava
-- Momentum/Tendência com peso cheio mesmo quando o sentimento da Narrativa
-- era muito positivo (ex: vídeo institucional viralizando de forma
-- elogiosa) — inflando risco em casos que não são, de fato, uma ameaça.
--
-- Pedido do usuário (2026-07-25, resposta à pergunta feita nesta sessão):
-- "Implementar termo de interação agora" — amortecer a contribuição de
-- Momentum/Tendência quando sentiment_risk for baixo (sentimento positivo).
--
-- Fórmula do amortecedor:
--   sentiment_dampener = least(1, greatest(0.5, sentiment_risk / 50.0))
-- sentiment_risk já é (100 - net_sentiment) / 2, então:
--   net_sentiment <= 0   (sentiment_risk >= 50) -> dampener = 1 (sem mudança)
--   net_sentiment ~ +50  (sentiment_risk = 25)   -> dampener = 0.5 (linear)
--   net_sentiment >= +100 (sentiment_risk = 0)   -> dampener = 0.5 (piso)
-- Só amortece quando o sentimento é líquido positivo (nunca amplifica pra
-- sentimento negativo) e nunca zera Momentum/Tendência por completo (piso
-- 0.5) — uma Narrativa virótica ainda merece alguma atenção de risco
-- mesmo com tom elogioso, só não o mesmo peso que uma virótica negativa.
-- Pesos/estrutura dos outros 4 termos (sentiment_risk/reach_risk/
-- author_influence/impact_risk) ficam exatamente como antes.
--
-- create or replace basta aqui — mesma assinatura/retorno de
-- 20260722010000, só o corpo da CTE `risk` muda.
--
-- ⚠️ Bug real encontrado e corrigido na mesma migration (2026-07-25,
-- screenshot do usuário): a borda esquerda do card de Narrativa e a coluna
-- "Sentimento" da tabela usavam `net_sentiment`/`sentiment_label` vindos de
-- `latest_day` — o snapshot de UM ÚNICO DIA (o mais recente dentro do
-- período, via `distinct on ... order by metric_date desc`) — enquanto
-- `sentiment_positive_pct`/`neutral_pct`/`negative_pct` (a barra pos/neu/neg
-- exibida no mesmo card) vinham de `period_agg`, somado sobre TODO o
-- período pedido (p_period_start..p_period_end). São duas janelas de tempo
-- diferentes: um dia isolado pode ter um tom bem diferente da média do
-- período inteiro, então o rótulo/borda e a barra podiam legitimamente
-- discordar (ex: "Renan Santos" com borda vermelha de
-- sentiment_label='slightly_negative' do último dia, mas neu=62.8% sendo o
-- predominante na soma do período; "Segurança Pública" com borda cinza de
-- sentiment_label='neutral' do último dia, mas neg=40.2% predominante na
-- soma do período). Corrigido: net_sentiment/sentiment_label agora vêm de
-- `sentiment_final`, calculado sobre a MESMA janela agregada de
-- `period_agg` usada pelas porcentagens — média de net_sentiment ponderada
-- por total_mentions nos dias em que net_sentiment já sincronizou (mesmo
-- agregado oficial da Brandwatch, só que sobre o período, não um único
-- dia), com fallback pro cálculo local (positivo/(positivo+negativo)*100,
-- mesma base já usada por sentiment_positive_pct — nunca dilui pelo total
-- de mentions, mesmo cuidado de 20260720000000) só quando net_sentiment não
-- sincronizou pra nenhum dia do período. `risk_inputs.sentiment_risk`
-- também passa a ler esse net_sentiment period-consistente, em vez do de
-- `latest_day` — mantém risk_score coerente com o que o card/tabela agora
-- mostram.

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
  -- Sentimento consistente com o período agregado (não mais o snapshot de
  -- um único dia de `latest_day`) — ver nota no topo do arquivo.
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
  trend_series as (
    select
      s.id as narrative_id,
      nm.total_mentions,
      row_number() over (partition by s.id order by nm.metric_date) as day_index
    from scope s
    join narrative_metrics nm
      on nm.narrative_id = s.id
      and nm.period = 'daily'
      and nm.metric_date >= current_date - interval '13 days'
      and nm.metric_date <= current_date
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
      -- ✅ Termo de interação (2026-07-25, decisão #3): amortece a
      -- contribuição conjunta de Momentum+Tendência (0.25 + 0.20 = 0.45 do
      -- total) quando o sentimento é líquido positivo — nunca abaixo de
      -- 50% do peso original (narrativa virótica ainda pesa, só não tanto
      -- quanto uma virótica negativa), nunca acima de 100% (sentimento
      -- negativo/neutro não amplifica, mantém a fórmula original).
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

comment on function get_narratives_table(uuid, date, date, jsonb, uuid, text) is
  'Bloco `narratives` do envelope. p_scope: null = sem filtro extra, ''roots'' = só Category de topo, ''leaves'' = só Subcategory de qualquer Category, ''pautas'' = só Subcategory cuja Category-pai é a Category raiz "Pautas" (pautas_root_category_id). risk_score (migration 20260725000000) ganhou um termo de interação: a contribuição conjunta de momentum_score+trend_score é amortecida (piso 50%) quando sentiment_risk é baixo (sentimento líquido positivo) — resolve a decisão #3 de _pending.md, evita inflar risco de uma Narrativa viralizando de forma elogiosa. net_sentiment/sentiment_label (mesma migration, correção 2026-07-25) são calculados sobre o MESMO período agregado de sentiment_positive_pct/neutral_pct/negative_pct — média de net_sentiment ponderada por total_mentions no período, com fallback pro cálculo local — nunca mais o snapshot de um único dia, que podia divergir da barra pos/neu/neg exibida no mesmo card.';
