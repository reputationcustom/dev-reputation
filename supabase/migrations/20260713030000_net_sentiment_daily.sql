-- Módulo: foundation
-- Fonte: .dev/specs/foundation/data-model.md, .dev/specs/foundation/sync-brandwatch.md passo 6.3d
-- Fonte: .dev/specs/_pending.md, gap técnico #1 de foundation
--
-- Pedido do usuário (2026-07-13): "verifique se na foundation os dados de
-- net sentiment estão vindo da brandwatch, se não tiver, ajuste a
-- especificação para buscarmos esse dados". `netSentiment` já era
-- capturado pra pageTypes (bw_query_metrics_daily_by_platform) e pras 4
-- dimensões de localização (bw_query_demographics_daily), migration
-- 20260712020000 — mas nunca pra `categories`/`queries` (por Narrativa e
-- Query inteira), que é o que a tabela interativa de Narrativas precisa
-- pro indicador de Sentimento. Mesmo aggregate, mesmas dimensões já usadas
-- por reach_estimate/engagement_score/unique_authors/impressions.

alter table bw_query_metrics_daily
  add column if not exists net_sentiment numeric;

alter table narrative_metrics
  add column if not exists net_sentiment numeric;

-- refresh_narrative_metrics() ganha net_sentiment no insert/upsert — mesma
-- fonte (bw_query_metrics_daily), mesmo padrão de unique_authors em
-- 20260712020000.
create or replace function refresh_narrative_metrics(
  p_from date default current_date - 1,
  p_to date default current_date - 1
)
returns void
language plpgsql
as $$
begin
  insert into narrative_metrics (
    narrative_id, query_id, metric_date, period, source,
    total_mentions, sentiment_positive, sentiment_neutral, sentiment_negative,
    reach_estimated, engagement_total, unique_authors, net_sentiment
  )
  select
    n.id, q.query_id, q.metric_date, 'daily', 'bw_aggregate',
    q.total_mentions, q.sentiment_positive, q.sentiment_neutral, q.sentiment_negative,
    q.reach_estimate, q.engagement_score, q.unique_authors, q.net_sentiment
  from narratives n
  join bw_categories bc on bc.id = n.bw_category_id
  join bw_query_metrics_daily q
    on q.category_id = n.bw_category_id
    and q.query_id = any(bc.query_ids)
    and q.metric_date between p_from and p_to
  where n.bw_category_id is not null
    and array_length(bc.query_ids, 1) = 1
  on conflict (narrative_id, metric_date, period) do update set
    query_id = excluded.query_id,
    source = excluded.source,
    total_mentions = excluded.total_mentions,
    sentiment_positive = excluded.sentiment_positive,
    sentiment_neutral = excluded.sentiment_neutral,
    sentiment_negative = excluded.sentiment_negative,
    reach_estimated = excluded.reach_estimated,
    engagement_total = excluded.engagement_total,
    unique_authors = excluded.unique_authors,
    net_sentiment = excluded.net_sentiment;
end;
$$;

-- public.narratives_overview (a view canônica — reporting.narratives_overview
-- é só um espelho fino dela, ver Reporting/BI split em CLAUDE.md) passa a
-- expor net_sentiment/reach_estimated/engagement_total/unique_authors e a
-- usar o score oficial no sentiment_bucket (7 faixas), com fallback pro
-- cálculo local só enquanto net_sentiment ainda não sincronizou pra essa
-- linha — ver foundation/data-model.md pra tabela de faixas completa.
--
-- As 4 métricas novas são anexadas DEPOIS de sentiment_bucket (não
-- intercaladas entre total_mentions e sov_percent) porque `create or
-- replace view` proíbe renomear/reordenar colunas de saída já existentes —
-- só permite acrescentar no final. Inserir net_sentiment antes de
-- reach_estimated/engagement_total/unique_authors (como numa primeira
-- tentativa desta migration) empurrava sov_percent da posição 8 pra 12 e
-- quebrava com "cannot change name of view column sov_percent to
-- net_sentiment" (SQLSTATE 42P16).
create or replace view public.narratives_overview as
with daily as (
  select narrative_id, query_id, metric_date, total_mentions,
         sentiment_positive, sentiment_neutral, sentiment_negative,
         net_sentiment, reach_estimated, engagement_total, unique_authors,
         lag(total_mentions) over (partition by narrative_id order by metric_date) as prev_total_mentions
  from narrative_metrics
  where period = 'daily'
),
query_totals as (
  select metric_date, query_id, sum(total_mentions) as query_total_mentions
  from narrative_metrics
  where period = 'daily' and query_id is not null
  group by metric_date, query_id
)
select
  n.id as narrative_id,
  n.organization_id,
  n.title,
  n.stage,
  n.risk_level,
  d.metric_date,
  d.total_mentions,
  round(100.0 * d.total_mentions / nullif(t.query_total_mentions, 0), 1) as sov_percent,
  round(100.0 * (d.total_mentions - d.prev_total_mentions) / nullif(d.prev_total_mentions, 0), 1) as trend_percent,
  coalesce(
    case
      when d.net_sentiment >= 50 then 'very_positive'
      when d.net_sentiment >= 20 then 'positive'
      when d.net_sentiment >= 5 then 'slightly_positive'
      when d.net_sentiment >= -4 then 'neutral'
      when d.net_sentiment >= -19 then 'slightly_negative'
      when d.net_sentiment >= -49 then 'negative'
      when d.net_sentiment is not null then 'very_negative'
    end,
    case
      when d.total_mentions = 0 then 'neutral'
      when (d.sentiment_positive - d.sentiment_negative)::numeric / d.total_mentions > 0.2 then 'positive'
      when (d.sentiment_positive - d.sentiment_negative)::numeric / d.total_mentions < -0.2 then 'negative'
      else 'neutral'
    end
  ) as sentiment_bucket,
  d.net_sentiment,
  d.reach_estimated,
  d.engagement_total,
  d.unique_authors
from narratives n
join daily d on d.narrative_id = n.id
left join query_totals t on t.metric_date = d.metric_date and t.query_id = d.query_id;

comment on view public.narratives_overview is
  'View usada pela tabela interativa de Narrativas no Executive Overview (via PostgREST/RLS). sov_percent = menções da Narrativa / total de menções de todas as Narrativas da MESMA Query (candidato/monitoramento) no mesmo dia. sentiment_bucket usa net_sentiment (score oficial da Brandwatch, 7 faixas) com fallback pro cálculo local só enquanto net_sentiment não sincronizou. Momentum/Velocidade/Risco (scores 0-100) NÃO vivem nesta view — são período-dependentes e ficam em aggregated-metrics.get_narratives_table().';

-- reporting.narratives_overview continua um espelho fino de
-- public.narratives_overview (Reporting/BI split, CLAUDE.md) — herda as 4
-- colunas novas automaticamente via select *.
create or replace view reporting.narratives_overview as
select * from public.narratives_overview;

comment on view reporting.narratives_overview is
  'Espelho de public.narratives_overview para BI externo via bi_reader (conexão Postgres direta). bi_reader tem bypassrls — enxerga todas as organizações por design (uso interno da Lidi, ver Princípio técnico 6 em _index.md); não confundir com acesso multi-tenant seguro.';
