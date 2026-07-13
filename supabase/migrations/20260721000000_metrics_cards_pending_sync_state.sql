-- Módulo: aggregated-metrics
-- Pedido do usuário (2026-07-21, revisão da Visão Geral): "Valores nulos em
-- Autores únicos, Alcance estimado e Engajamento total quando o período
-- Diário é selecionado."
--
-- Causa raiz: bw_query_metrics_daily.reach_estimate/engagement_score/
-- unique_authors são colunas nullable sem default (20260710040000/
-- 20260712020000), preenchidas por chamadas separadas
-- (syncCategoryDailyAggregate/syncQueryDailyAggregate) dentro da fase
-- daily_metrics de bw-sync — chamadas que rodam DEPOIS do loop de
-- sentimento e das 2 chamadas de netSentiment (reordenadas 2026-07-20 pra
-- sobreviver ao corte de orçamento com prioridade). Ou seja: a linha de
-- HOJE em bw_query_metrics_daily normalmente já existe (total_mentions/
-- sentimento populados pela primeira chamada da fase, que sempre roda)
-- mas ainda pode ter essas 3 colunas null até uma chamada mais tardia da
-- MESMA invocação (ou de uma invocação seguinte) alcançá-las — em qualquer
-- invocação onde o orçamento de 25 chamadas (BRANDWATCH_CALL_BUDGET) se
-- esgota antes de chegar nelas, o que se torna mais provável quanto mais
-- Narrativas a organização tiver (o loop de sentimento sozinho já consome
-- 1 chamada por Narrativa + Query inteira).
--
-- get_metrics_cards já fazia `coalesce(sum(...), 0)` incondicional pras 3
-- métricas. Pra um período de 7/30 dias isso é inofensivo — a soma dos
-- outros dias já sincronizados mascara um único dia ainda pendente. Mas
-- pra "Diário" (1 dia = hoje, único dia no período), esse coalesce
-- transforma "ainda não sincronizado" num falso 0 — indistinguível de
-- "não houve nenhuma atividade hoje" e, pior, produz um falso "-100% vs.
-- período anterior" no card (trend "down"), quando na realidade não há
-- nenhum dado ainda, positivo ou negativo, pra comparar.
--
-- Corrigido: current_value/previous_value de reach_estimate/
-- engagement_score/unique_authors agora distinguem os dois casos —
-- retornam NULL (ainda sincronizando) só quando o dia já tem menções
-- (total_mentions > 0) mas a métrica em si ainda está com a coluna
-- inteiramente null nesse intervalo; continuam em 0 quando realmente não
-- houve menção nenhuma no período (nesse caso 0 é o valor correto, não um
-- placeholder). total_mentions/net_sentiment não mudam — total_mentions
-- tem `not null default 0` na tabela (sempre populado pela mesma chamada
-- que cria a linha do dia, nunca fica pendente sozinho) e net_sentiment já
-- tinha seu próprio tratamento de null via média ponderada.
--
-- Frontend (metric-card.tsx) passa a renderizar "—" com a nota "Ainda
-- sincronizando…" pra um valor null, em vez de reaproveitar o mesmo "0"
-- usado pra ausência real de dado — ver commit desta sessão.
create or replace function get_metrics_cards(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  metric_key text,
  current_value numeric,
  previous_value numeric,
  delta_pct numeric,
  trend text
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
  current_agg as (
    select
      coalesce(sum(total_mentions), 0) as total_mentions,
      sum(reach_estimate) as reach_estimate,
      sum(engagement_score) as engagement_score,
      sum(unique_authors) as unique_authors,
      sum(net_sentiment * total_mentions) filter (where net_sentiment is not null) as net_sentiment_weighted,
      sum(total_mentions) filter (where net_sentiment is not null) as net_sentiment_weight
    from bw_query_metrics_daily
    where query_id in (select org_query_ids(p_organization_id))
      and category_id is null
      and metric_date between p_period_start and p_period_end
  ),
  previous_agg as (
    select
      coalesce(sum(total_mentions), 0) as total_mentions,
      sum(reach_estimate) as reach_estimate,
      sum(engagement_score) as engagement_score,
      sum(unique_authors) as unique_authors,
      sum(net_sentiment * total_mentions) filter (where net_sentiment is not null) as net_sentiment_weighted,
      sum(total_mentions) filter (where net_sentiment is not null) as net_sentiment_weight
    from bw_query_metrics_daily
    where query_id in (select org_query_ids(p_organization_id))
      and category_id is null
      and metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)
  ),
  metrics as (
    select 'total_mentions' as metric_key,
           (select total_mentions from current_agg)::numeric as current_value,
           (select total_mentions from previous_agg)::numeric as previous_value
    union all
    select 'reach_estimate',
           case
             when (select reach_estimate from current_agg) is not null then (select reach_estimate from current_agg)
             when (select total_mentions from current_agg) > 0 then null
             else 0
           end,
           case
             when (select reach_estimate from previous_agg) is not null then (select reach_estimate from previous_agg)
             when (select total_mentions from previous_agg) > 0 then null
             else 0
           end
    union all
    select 'engagement_score',
           case
             when (select engagement_score from current_agg) is not null then (select engagement_score from current_agg)
             when (select total_mentions from current_agg) > 0 then null
             else 0
           end,
           case
             when (select engagement_score from previous_agg) is not null then (select engagement_score from previous_agg)
             when (select total_mentions from previous_agg) > 0 then null
             else 0
           end
    union all
    select 'unique_authors',
           case
             when (select unique_authors from current_agg) is not null then (select unique_authors from current_agg)
             when (select total_mentions from current_agg) > 0 then null
             else 0
           end,
           case
             when (select unique_authors from previous_agg) is not null then (select unique_authors from previous_agg)
             when (select total_mentions from previous_agg) > 0 then null
             else 0
           end
    union all
    -- net_sentiment é score, não contagem — soma não faz sentido; usa média
    -- ponderada por total_mentions do próprio período (combina scores
    -- oficiais diários já não-amostrados, não recalcula sobre mentions).
    select 'net_sentiment',
           (select net_sentiment_weighted / nullif(net_sentiment_weight, 0) from current_agg),
           (select net_sentiment_weighted / nullif(net_sentiment_weight, 0) from previous_agg)
  )
  select
    metric_key,
    current_value,
    previous_value,
    case
      when metric_key = 'net_sentiment' then round(current_value - previous_value, 1)
      when current_value is null or previous_value is null or previous_value = 0 then null
      else round(((current_value - previous_value) / previous_value) * 100, 1)
    end as delta_pct,
    case
      when previous_value is null or current_value is null then 'stable'
      when current_value > previous_value then 'up'
      when current_value < previous_value then 'down'
      else 'stable'
    end as trend
  from metrics
$$;
