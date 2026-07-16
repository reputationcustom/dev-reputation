-- ai-synthesis (get_volume_delta) + KPI cards (get_metrics_cards) — mesma
-- classe de bug já corrigida no event-radar (20260809150000): comparar um
-- período "atual" que sempre inclui o dia de hoje (ainda incompleto)
-- contra um período "anterior" inteiramente histórico produz uma queda
-- artificial.
--
-- User request: "com essa mesma perspectiva que foi corrigida no radar,
-- verifique na ai-synthesis se também precisa dessa melhoria de
-- considerar as últimas 24h, semanal os últimos 7 dias e mensal os
-- últimos 30 dias, uma vez que através dessa funcionalidade que são
-- criadas as sínteses das páginas."
--
-- Confirmado: `get_volume_delta` (fonte do texto "Volume cresceu/caiu X%
-- em relação ao período anterior" da Camada 0 de ai-synthesis.md) sempre
-- soma `current_value` sobre [p_period_start, p_period_end] — e o
-- seletor de período do header (Diário/Semanal/Mensal,
-- `getLastNDaysRange`, header-context.tsx) sempre fixa `p_period_end =
-- hoje`. `previous_value` é sempre um período histórico inteiramente
-- fechado, de mesma duração — mesma assimetria já corrigida no
-- event-radar, pior quanto menor a janela (100% do período "Diário" é o
-- dia incompleto; ~1/7 pro "Semanal"; ~1/30 pro "Mensal").
--
-- ⚠️ Achado adicional, ampliando o escopo desta correção (confirmado com
-- o usuário via AskUserQuestion antes de implementar): o MESMO bug existe
-- em `get_metrics_cards` — os cards de KPI ("Total de Menções" etc.,
-- "vs. período anterior") mostrados em TODA página, não só o texto do
-- ai-synthesis. Corrigir só `get_volume_delta` deixaria o card de KPI e o
-- texto da síntese, lado a lado na mesma tela, discordando um do outro —
-- mesma classe de inconsistência já encontrada e corrigida várias vezes
-- neste projeto (ver CLAUDE.md, "Narrative card border/table Sentimento
-- column disagreeing..."). Por isso esta migration corrige as DUAS
-- funções juntas.
--
-- Desenho do fix — diferente do event-radar (que é um motor de detecção
-- sem nenhuma obrigação de "mostrar o valor ao vivo pro usuário" e por
-- isso pôde simplesmente EXCLUIR hoje das janelas de comparação):
-- `current_value` aqui é um número exibido ao vivo no dashboard (o
-- usuário espera ver "hoje até agora" quando seleciona "Diário" — mudar
-- isso pra "ontem" seria uma regressão de produto, não uma correção).
-- `get_volume_trend`'s próprio grão "hour" pra período Diário (2026-07-19)
-- já confirma essa convenção: "Diário" = dia corrido (meia-noite até
-- agora), nunca uma janela rolante de 24h real — mudar `current_value`
-- pra outra definição aqui criaria uma NOVA divergência com o gráfico de
-- tendência da mesma página.
--
-- Fix real: `current_value` nunca muda. `previous_value` (a base de
-- comparação) passa a truncar o ÚLTIMO DIA do período anterior na MESMA
-- fração do dia já decorrida hoje — via `bw_query_metrics_hourly` (janela
-- móvel de 30 dias, grão horário) — comparação "parcial vs. parcial",
-- nunca "parcial vs. inteiro". Generaliza uniformemente pros 3 modos
-- (Diário: o único dia do período anterior vira 100% parcial; Semanal: 6
-- dias completos + 1 parcial; Mensal: 29 dias completos + 1 parcial) sem
-- precisar de um branch por modo — só ativa quando `p_period_end =
-- current_date` (funciona também pra um período `custom` que happen a
-- terminar hoje, não só pelos 3 modos nomeados).
--
-- ⚠️ Limitação real, documentada: `bw_query_metrics_hourly` só tem
-- `total_mentions`/`sentiment_*`/`net_sentiment` em grão horário — não tem
-- `reach_estimate`/`engagement_score`/`unique_authors`. Em
-- `get_metrics_cards`, só `total_mentions`/`net_sentiment` recebem o
-- ajuste de dia parcial; os outros 3 KPIs continuam com o mesmo viés de
-- antes (gap honesto, sem fonte horária pra corrigir — não inventado).
--
-- ⚠️ Trade-off aceito: se `bw_query_metrics_hourly` não tiver dado pro
-- último dia do período anterior (ex: fora da janela de retenção de 30
-- dias no caso "Mensal", ou um gap de sync), a fração parcial soma 0 —
-- `previous_value` fica levemente subestimado (falso "cresceu" em vez de
-- "caiu"), mesma classe de degradação graciosa já aceita em outras partes
-- deste módulo quando falta dado horário.

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
  previous_agg_full as (
    select coalesce(sum(total_mentions), 0) as total
    from scoped
    where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)
  ),
  includes_today as (
    select (p_period_end = current_date) as flag
  ),
  elapsed as (
    select extract(epoch from now() - date_trunc('day', now())) / 3600.0 as hours
  ),
  prev_end_day as (
    select coalesce(sum(total_mentions), 0) as total
    from scoped
    where metric_date = (select prev_end from prev_range)
  ),
  prev_partial_day as (
    select coalesce(sum(h.total_mentions), 0) as total
    from bw_query_metrics_hourly h
    cross join cat_ids
    cross join elapsed e
    where (select flag from includes_today)
      and h.query_id in (select org_query_ids(p_organization_id))
      and h.metric_hour >= (select prev_end from prev_range)::timestamptz
      and h.metric_hour < (select prev_end from prev_range)::timestamptz + (e.hours || ' hours')::interval
      and (
        (cat_ids.ids is null and h.category_id is null)
        or h.category_id = any(cat_ids.ids)
      )
  ),
  previous_final as (
    select
      (select total from previous_agg_full)
        - (case when (select flag from includes_today) then (select total from prev_end_day) else 0 end)
        + (case when (select flag from includes_today) then (select total from prev_partial_day) else 0 end)
      as total
  )
  select
    (select total from current_agg)::bigint as current_value,
    (select total from previous_final)::bigint as previous_value,
    case when (select total from previous_final) = 0 then null
         else round((((select total from current_agg) - (select total from previous_final))::numeric
              / (select total from previous_final)) * 100, 1)
    end as delta_pct,
    case
      when (select total from previous_final) = 0 then 'stable'
      when (select total from current_agg) > (select total from previous_final) then 'up'
      when (select total from current_agg) < (select total from previous_final) then 'down'
      else 'stable'
    end as trend
$$;

comment on function get_volume_delta(uuid, date, date, jsonb) is
  'Helper de ai-synthesis.md Camada 0 (narrative_text) — total_mentions do período atual vs. anterior, escopado por filters.narratives (mesmo padrão de get_sentiment_breakdown). ✅ 2026-07-16: previous_value trunca o último dia na mesma fração já decorrida de hoje (via bw_query_metrics_hourly), evitando comparar um dia parcial com um dia inteiro. Não é um bloco do envelope, só consumido pela service layer.';

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
  includes_today as (
    select (p_period_end = current_date) as flag
  ),
  elapsed as (
    select extract(epoch from now() - date_trunc('day', now())) / 3600.0 as hours
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
  previous_agg_full as (
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
  -- prev_end_day/prev_partial_day só ajustam total_mentions/net_sentiment
  -- (únicos com grão horário disponível). reach_estimate/engagement_score/
  -- unique_authors continuam lidos direto de previous_agg_full, sem
  -- ajuste — gap honesto, ver comentário no topo do arquivo.
  prev_end_day as (
    select
      coalesce(sum(total_mentions), 0) as total_mentions,
      sum(net_sentiment * total_mentions) filter (where net_sentiment is not null) as net_sentiment_weighted,
      sum(total_mentions) filter (where net_sentiment is not null) as net_sentiment_weight
    from bw_query_metrics_daily
    where query_id in (select org_query_ids(p_organization_id))
      and category_id is null
      and metric_date = (select prev_end from prev_range)
  ),
  prev_partial_day as (
    select
      coalesce(sum(h.total_mentions), 0) as total_mentions,
      sum(h.net_sentiment * h.total_mentions) filter (where h.net_sentiment is not null) as net_sentiment_weighted,
      sum(h.total_mentions) filter (where h.net_sentiment is not null) as net_sentiment_weight
    from bw_query_metrics_hourly h
    cross join elapsed e
    where (select flag from includes_today)
      and h.query_id in (select org_query_ids(p_organization_id))
      and h.category_id is null
      and h.metric_hour >= (select prev_end from prev_range)::timestamptz
      and h.metric_hour < (select prev_end from prev_range)::timestamptz + (e.hours || ' hours')::interval
  ),
  previous_agg as (
    select
      (select total_mentions from previous_agg_full)
        - (case when (select flag from includes_today) then (select total_mentions from prev_end_day) else 0 end)
        + (case when (select flag from includes_today) then (select total_mentions from prev_partial_day) else 0 end)
        as total_mentions,
      (select reach_estimate from previous_agg_full) as reach_estimate,
      (select engagement_score from previous_agg_full) as engagement_score,
      (select unique_authors from previous_agg_full) as unique_authors,
      (select net_sentiment_weighted from previous_agg_full)
        - (case when (select flag from includes_today) then coalesce((select net_sentiment_weighted from prev_end_day), 0) else 0 end)
        + (case when (select flag from includes_today) then coalesce((select net_sentiment_weighted from prev_partial_day), 0) else 0 end)
        as net_sentiment_weighted,
      (select net_sentiment_weight from previous_agg_full)
        - (case when (select flag from includes_today) then coalesce((select net_sentiment_weight from prev_end_day), 0) else 0 end)
        + (case when (select flag from includes_today) then coalesce((select net_sentiment_weight from prev_partial_day), 0) else 0 end)
        as net_sentiment_weight
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

comment on function get_metrics_cards(uuid, date, date, jsonb) is
  'KPI cards da Visão Geral (e demais páginas) — 5 métricas, atual vs. período anterior. ✅ 2026-07-16: total_mentions/net_sentiment truncam o último dia do período anterior na mesma fração já decorrida de hoje (via bw_query_metrics_hourly), evitando comparar um dia parcial com um dia inteiro (mesmo fix de get_volume_delta). reach_estimate/engagement_score/unique_authors continuam sem esse ajuste — bw_query_metrics_hourly não tem grão horário pra esses 3 campos.';
