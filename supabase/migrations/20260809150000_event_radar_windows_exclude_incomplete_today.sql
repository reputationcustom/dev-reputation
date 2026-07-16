-- event-radar 1.1/1.6 — janelas de calendário comparavam um "hoje" ainda
-- incompleto contra um dia histórico já fechado, produzindo quedas/picos
-- artificiais.
--
-- User report: cards do Radar de Eventos descrevendo, por exemplo,
-- "No Twitter, o volume despencou 80,7% em 3 dias (de 196.455 para 37.927
-- menções), enquanto o Reddit registrou queda de 79,6% em 3 dias e 98,9%
-- na comparação semanal" — números que não batem com a realidade (o
-- usuário confirma que o volume diário do Twitter se mantém estável, na
-- faixa de 50-55% das menções). Pedido: garantir que o diário compare as
-- últimas 24h, o semanal os últimos 7 dias e o mensal os últimos 30 dias,
-- para nunca comparar poucas horas de um dia em andamento com um dia
-- inteiro já fechado.
--
-- Causa raiz confirmada por leitura de código: `event_radar_daily_range`
-- (helper genérico, nunca hardcoda "hoje" — recebe datas explícitas) está
-- correto; o bug está em COMO `run_event_detection()`/
-- `event_radar_narrative_momentum()` chamam esse helper. As janelas "3d" e
-- "today_vs_last_week" sempre usavam `current_date` (hoje) como uma das
-- bordas do período "atual" — `current_date - 2` até `current_date`
-- ("3d") e `current_date` até `current_date` ("today_vs_last_week"). Como
-- o dia de hoje ainda está em andamento (só uma fração das 24h já se
-- passou, e `bw-sync` só reflete o que já foi sincronizado até agora),
-- somar "hoje" sempre subestima o volume real do dia — e comparar isso
-- contra 3 dias/1 dia HISTÓRICOS, já fechados por completo, produz uma
-- "queda" que não é real, só um artefato de comparar um dia incompleto
-- com um dia completo. Mesmo bug, mesma causa, também embutido em
-- `event_radar_narrative_momentum()` (a fonte do evento `momentum_spike`,
-- 20260807000000) — sua janela "3 dias" também somava
-- `current_date - 2` até `current_date`.
--
-- As janelas "3h"/"24h" (event_radar_hourly_symmetric, baseadas em
-- `now()` real, não em fronteira de calendário) e
-- "current_hour_vs_4week_avg" (usa explicitamente "a última hora já
-- fechada", `date_trunc('hour', now()) - interval '1 hour'`) NUNCA
-- tiveram esse problema — são as únicas janelas hoje que cobrem
-- corretamente "diário = últimas 24h" para escopo query/narrative
-- (não há grão horário por plataforma, então plataforma nunca teve uma
-- comparação diária real — só "3d"/"today_vs_last_week", ambas bugadas,
-- o que explica por que o sintoma relatado apareceu especificamente em
-- Twitter/Reddit).
--
-- Fix: toda janela de calendário passa a ancorar no último dia JÁ
-- FECHADO (`current_date - 1`, "ontem"), nunca em `current_date` (hoje,
-- ainda em andamento):
--   - "3d" (volume_spike/drop, momentum_spike): últimos 3 dias completos
--     (current_date-3..current_date-1) vs. 3 dias completos anteriores
--     (current_date-6..current_date-4). Antes incluía hoje.
--   - "today_vs_last_week" REMOVIDA como regra ativa (window value mantido
--     no CHECK constraint só para não invalidar linhas históricas já
--     fechadas) e substituída por uma nova janela "7d": últimos 7 dias
--     completos (current_date-7..current_date-1) vs. 7 dias completos
--     anteriores (current_date-14..current_date-8) — "semanal = últimos 7
--     dias", conforme pedido, em vez de um snapshot "hoje vs. mesmo dia da
--     semana passada" que sempre comparava um dia parcial contra um dia
--     inteiro.
--   - "30d" (nova): últimos 30 dias completos (current_date-30..
--     current_date-1) vs. 30 dias completos anteriores (current_date-60..
--     current_date-31) — "mensal = últimos 30 dias", gap real (não existia
--     nenhuma janela mensal antes desta migration).
-- "3h"/"24h"/"current_hour_vs_4week_avg" não mudam — já corretas.

-- =========================================================================
-- 1. CHECK constraint de radar_staging_events."window" ganha '7d'/'30d' —
--    aditivo (superset dos valores já aceitos), nenhuma linha existente
--    pode violar. 'today_vs_last_week' continua uma opção válida (nunca
--    mais inserida por run_event_detection() a partir desta migration) só
--    para não invalidar linhas históricas já fechadas com esse valor.
-- =========================================================================

alter table radar_staging_events
  drop constraint if exists radar_staging_events_window_check;

alter table radar_staging_events
  add constraint radar_staging_events_window_check
  check ("window" in (
    '3h', '24h', 'today_vs_last_week', 'current_hour_vs_4week_avg', '3d',
    '7d', '30d'
  ));

-- =========================================================================
-- 2. event_radar_narrative_momentum — mesma fórmula/pesos de sempre, só a
--    janela "3 dias" deixa de incluir o dia de hoje (ainda em andamento).
-- =========================================================================

create or replace function event_radar_narrative_momentum(p_organization_id uuid)
returns table (
  scope_id        text,
  momentum_score  numeric
)
language sql
stable
as $$
  with scope as (
    select n.id as narrative_id
    from narratives n
    join bw_categories bc on bc.id = n.bw_category_id
    where n.organization_id = p_organization_id
      and bc.status = 'active'
  ),
  period_agg as (
    select
      s.narrative_id,
      sum(nm.total_mentions) filter (
        where nm.metric_date between current_date - 3 and current_date - 1
      ) as vol_current,
      sum(nm.total_mentions) filter (
        where nm.metric_date between current_date - 6 and current_date - 4
      ) as vol_previous,
      sum(nm.engagement_total) filter (
        where nm.metric_date between current_date - 3 and current_date - 1
      ) as engagement_current,
      sum(nm.engagement_total) filter (
        where nm.metric_date between current_date - 6 and current_date - 4
      ) as engagement_previous,
      avg(nm.unique_authors) filter (
        where nm.metric_date between current_date - 3 and current_date - 1
      ) as authors_current,
      avg(nm.unique_authors) filter (
        where nm.metric_date between current_date - 6 and current_date - 4
      ) as authors_previous,
      sum(nm.reach_estimated) filter (
        where nm.metric_date between current_date - 3 and current_date - 1
      ) as reach_current,
      sum(nm.reach_estimated) filter (
        where nm.metric_date between current_date - 6 and current_date - 4
      ) as reach_previous
    from scope s
    join narrative_metrics nm on nm.narrative_id = s.narrative_id
    where nm.period = 'daily'
    group by s.narrative_id
  )
  select
    p.narrative_id::text,
    round(
      0.40 * norm_growth(p.vol_current, p.vol_previous) +
      0.25 * norm_growth(p.engagement_current, p.engagement_previous) +
      0.20 * norm_growth(p.authors_current, p.authors_previous) +
      0.15 * norm_growth(p.reach_current, p.reach_previous)
    )
  from period_agg p
  where p.vol_current is not null;
$$;

-- =========================================================================
-- 3. run_event_detection() — corpo idêntico ao de 20260808000000, exceto:
--    (a) o bloco "3d" passa a usar dias completos (exclui hoje);
--    (b) o bloco "today_vs_last_week" é substituído por "7d" (últimos 7
--        dias completos vs. 7 dias completos anteriores);
--    (c) novo bloco "30d" (últimos 30 dias completos vs. 30 dias completos
--        anteriores), todos os escopos;
--    (d) momentum_spike passa a ler event_radar_narrative_momentum() já
--        corrigida acima — nenhuma mudança de código aqui além disso, o
--        fix já está na function chamada.
-- =========================================================================

create or replace function run_event_detection()
returns void
language plpgsql
as $$
declare
  v_cycle_start timestamptz;
  v_config record;
begin
  select * into v_config from event_radar_config();
  v_cycle_start := now();

  -- 3h vs 3h anteriores (volume) — query/narrative apenas.
  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, delta_pct, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'volume_spike', '3h',
    w.current_volume, w.previous_volume,
    event_radar_delta_pct(w.current_volume, w.previous_volume),
    v_cycle_start
  from organizations o
  cross join lateral event_radar_hourly_symmetric(o.id, 3) w
  where w.current_volume >= v_config.min_volume
    and event_radar_delta_pct(w.current_volume, w.previous_volume) >= v_config.spike_pct
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    delta_pct = excluded.delta_pct,
    detected_at = excluded.detected_at;

  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, delta_pct, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'volume_drop', '3h',
    w.current_volume, w.previous_volume,
    event_radar_delta_pct(w.current_volume, w.previous_volume),
    v_cycle_start
  from organizations o
  cross join lateral event_radar_hourly_symmetric(o.id, 3) w
  where w.previous_volume >= v_config.min_volume
    and event_radar_delta_pct(w.current_volume, w.previous_volume) <= v_config.drop_pct
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    delta_pct = excluded.delta_pct,
    detected_at = excluded.detected_at;

  -- 24h vs 24h anteriores (volume + sentimento) — query/narrative apenas.
  -- Já correta desde sempre: baseada em now() real, não em fronteira de
  -- calendário, então nunca compara um dia incompleto com um dia inteiro.
  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, delta_pct, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'volume_spike', '24h',
    w.current_volume, w.previous_volume,
    event_radar_delta_pct(w.current_volume, w.previous_volume),
    v_cycle_start
  from organizations o
  cross join lateral event_radar_hourly_symmetric(o.id, 24) w
  where w.current_volume >= v_config.min_volume
    and event_radar_delta_pct(w.current_volume, w.previous_volume) >= v_config.spike_pct
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    delta_pct = excluded.delta_pct,
    detected_at = excluded.detected_at;

  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, delta_pct, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'volume_drop', '24h',
    w.current_volume, w.previous_volume,
    event_radar_delta_pct(w.current_volume, w.previous_volume),
    v_cycle_start
  from organizations o
  cross join lateral event_radar_hourly_symmetric(o.id, 24) w
  where w.previous_volume >= v_config.min_volume
    and event_radar_delta_pct(w.current_volume, w.previous_volume) <= v_config.drop_pct
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    delta_pct = excluded.delta_pct,
    detected_at = excluded.detected_at;

  -- sentiment_change/negative_sentiment_increase são regras de "diferença
  -- absoluta" (detection-engine.md, "Regras de negócio"), não de variação
  -- percentual — delta_pct fica null aqui (schema não tem coluna dedicada
  -- pra diferença absoluta; metric_value - comparison_value já expressa
  -- isso pra quem consumir esta linha).
  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'sentiment_change', '24h',
    w.current_net_sentiment, w.previous_net_sentiment,
    v_cycle_start
  from organizations o
  cross join lateral event_radar_hourly_symmetric(o.id, 24) w
  where w.current_net_sentiment is not null
    and w.previous_net_sentiment is not null
    and abs(w.current_net_sentiment - w.previous_net_sentiment) >= v_config.net_sentiment_delta
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    detected_at = excluded.detected_at;

  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'negative_sentiment_increase', '24h',
    w.current_negative_share, w.previous_negative_share,
    v_cycle_start
  from organizations o
  cross join lateral event_radar_hourly_symmetric(o.id, 24) w
  where w.current_negative_share is not null
    and w.previous_negative_share is not null
    and (w.current_negative_share - w.previous_negative_share) >= v_config.negative_share_delta_pp
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    detected_at = excluded.detected_at;

  -- Últimos 7 dias completos vs. 7 dias completos anteriores (volume) —
  -- todos os escopos, incl. platform. Substitui "today_vs_last_week"
  -- (hoje, ainda incompleto, vs. mesmo dia da semana passada, já fechado)
  -- — "semanal = últimos 7 dias", nunca incluindo o dia em andamento.
  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, delta_pct, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'volume_spike', '7d',
    w.current_volume, w.previous_volume,
    event_radar_delta_pct(w.current_volume, w.previous_volume),
    v_cycle_start
  from organizations o
  cross join lateral event_radar_daily_range(
    o.id, current_date - 7, current_date - 1, current_date - 14, current_date - 8
  ) w
  where w.current_volume >= v_config.min_volume
    and event_radar_delta_pct(w.current_volume, w.previous_volume) >= v_config.spike_pct
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    delta_pct = excluded.delta_pct,
    detected_at = excluded.detected_at;

  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, delta_pct, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'volume_drop', '7d',
    w.current_volume, w.previous_volume,
    event_radar_delta_pct(w.current_volume, w.previous_volume),
    v_cycle_start
  from organizations o
  cross join lateral event_radar_daily_range(
    o.id, current_date - 7, current_date - 1, current_date - 14, current_date - 8
  ) w
  where w.previous_volume >= v_config.min_volume
    and event_radar_delta_pct(w.current_volume, w.previous_volume) <= v_config.drop_pct
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    delta_pct = excluded.delta_pct,
    detected_at = excluded.detected_at;

  -- Últimos 3 dias completos vs. 3 dias completos anteriores (volume) —
  -- todos os escopos. Antes incluía o dia de hoje (current_date) como
  -- fronteira do período "atual" — agora ancorado em "ontem"
  -- (current_date - 1), o último dia já fechado.
  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, delta_pct, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'volume_spike', '3d',
    w.current_volume, w.previous_volume,
    event_radar_delta_pct(w.current_volume, w.previous_volume),
    v_cycle_start
  from organizations o
  cross join lateral event_radar_daily_range(
    o.id, current_date - 3, current_date - 1, current_date - 6, current_date - 4
  ) w
  where w.current_volume >= v_config.min_volume
    and event_radar_delta_pct(w.current_volume, w.previous_volume) >= v_config.spike_pct
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    delta_pct = excluded.delta_pct,
    detected_at = excluded.detected_at;

  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, delta_pct, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'volume_drop', '3d',
    w.current_volume, w.previous_volume,
    event_radar_delta_pct(w.current_volume, w.previous_volume),
    v_cycle_start
  from organizations o
  cross join lateral event_radar_daily_range(
    o.id, current_date - 3, current_date - 1, current_date - 6, current_date - 4
  ) w
  where w.previous_volume >= v_config.min_volume
    and event_radar_delta_pct(w.current_volume, w.previous_volume) <= v_config.drop_pct
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    delta_pct = excluded.delta_pct,
    detected_at = excluded.detected_at;

  -- Últimos 30 dias completos vs. 30 dias completos anteriores (volume) —
  -- todos os escopos. Nova janela — "mensal = últimos 30 dias", gap real
  -- (nenhuma janela mensal existia antes desta migration).
  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, delta_pct, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'volume_spike', '30d',
    w.current_volume, w.previous_volume,
    event_radar_delta_pct(w.current_volume, w.previous_volume),
    v_cycle_start
  from organizations o
  cross join lateral event_radar_daily_range(
    o.id, current_date - 30, current_date - 1, current_date - 60, current_date - 31
  ) w
  where w.current_volume >= v_config.min_volume
    and event_radar_delta_pct(w.current_volume, w.previous_volume) >= v_config.spike_pct
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    delta_pct = excluded.delta_pct,
    detected_at = excluded.detected_at;

  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, delta_pct, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'volume_drop', '30d',
    w.current_volume, w.previous_volume,
    event_radar_delta_pct(w.current_volume, w.previous_volume),
    v_cycle_start
  from organizations o
  cross join lateral event_radar_daily_range(
    o.id, current_date - 30, current_date - 1, current_date - 60, current_date - 31
  ) w
  where w.previous_volume >= v_config.min_volume
    and event_radar_delta_pct(w.current_volume, w.previous_volume) <= v_config.drop_pct
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    delta_pct = excluded.delta_pct,
    detected_at = excluded.detected_at;

  -- Hora atual vs. média das últimas 4 semanas (z-score) — query/narrative
  -- apenas. z_score >= zscore_attention (2) já qualifica o candidato; a
  -- banda exata (atenção/relevante) vira severity só na etapa 1.3. Já
  -- correta desde sempre — usa explicitamente "a última hora já fechada".
  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, z_score, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'volume_spike', 'current_hour_vs_4week_avg',
    w.current_volume, w.volume_mean, w.volume_z_score, v_cycle_start
  from organizations o
  cross join lateral event_radar_hourly_zscore(o.id) w
  where w.volume_z_score is not null
    and w.current_volume >= v_config.min_volume
    and w.volume_z_score >= v_config.zscore_attention
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    z_score = excluded.z_score,
    detected_at = excluded.detected_at;

  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, z_score, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'volume_drop', 'current_hour_vs_4week_avg',
    w.current_volume, w.volume_mean, w.volume_z_score, v_cycle_start
  from organizations o
  cross join lateral event_radar_hourly_zscore(o.id) w
  where w.volume_z_score is not null
    and w.volume_mean >= v_config.min_volume
    and w.volume_z_score <= -v_config.zscore_attention
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    z_score = excluded.z_score,
    detected_at = excluded.detected_at;

  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, z_score, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'negative_sentiment_spike', 'current_hour_vs_4week_avg',
    w.current_negative_share, w.negative_share_mean, w.negative_share_z_score, v_cycle_start
  from organizations o
  cross join lateral event_radar_hourly_zscore(o.id) w
  where w.negative_share_z_score is not null
    and w.negative_share_z_score >= v_config.zscore_attention
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    z_score = excluded.z_score,
    detected_at = excluded.detected_at;

  -- Momentum "Explosivo" — Últimos 3 dias completos vs. 3 dias completos
  -- anteriores (mesma janela de event_radar_narrative_momentum(), já
  -- corrigida acima para excluir hoje), só escopo narrative. Reaproveita a
  -- janela "3d" já existente no CHECK constraint. metric_value =
  -- momentum_score calculado; comparison_value = o próprio limiar
  -- configurado (não há "valor anterior" de comparação natural aqui,
  -- diferente das regras de volume — a "linha de base" É o limiar).
  -- delta_pct/z_score ficam null (não se aplicam a este tipo de regra).
  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, detected_at
  )
  select
    o.id, 'narrative', m.scope_id, 'momentum_spike', '3d',
    m.momentum_score, v_config.momentum_spike_threshold, v_cycle_start
  from organizations o
  cross join lateral event_radar_narrative_momentum(o.id) m
  where m.momentum_score >= v_config.momentum_spike_threshold
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    detected_at = excluded.detected_at;

  -- 1.2 deduplication-grouping — "quando o indicador volta ao normal":
  -- toda regra acima é reavaliada por completo a cada ciclo (sem execução
  -- faseada, diferente de bw-sync) — se uma linha ativa não foi atualizada
  -- neste ciclo (detected_at ainda no valor de um ciclo anterior a
  -- v_cycle_start), a regra que a originou deixou de disparar. Fecha aqui,
  -- não numa função/step separado — encerramento depende exatamente da
  -- mesma matriz de regras já calculada acima, recalculá-la de novo numa
  -- função à parte seria dobrar o custo de leitura sem necessidade.
  -- Nota: qualquer linha ativa remanescente com "window" =
  -- 'today_vs_last_week' (regra removida nesta migration) nunca mais é
  -- atualizada por nenhum insert acima — fecha sozinha no próximo ciclo
  -- por esta mesma cláusula, sem precisar de um UPDATE dedicado.
  update radar_staging_events
  set closed_at = v_cycle_start
  where closed_at is null
    and detected_at < v_cycle_start;

  -- Espelha o encerramento no feed_events vinculado (1.4/schema-integration.md:
  -- "closed_at espelha radar_staging_events.closed_at, para o card sumir do
  -- bloco highlights quando o evento correspondente for encerrado").
  update feed_events fe
  set closed_at = v_cycle_start
  from radar_staging_events e4
  where fe.radar_staging_event_id = e4.id
    and e4.closed_at = v_cycle_start
    and fe.closed_at is null;

  -- 1.3 severity — score contínuo 0-100 sobre os eventos ativos (saída de
  -- 1.2, já calculada acima nesta mesma função) + mapeamento pra
  -- severity_level (mesmas 4 faixas de risk_score, aggregated-metrics/
  -- sql-aggregation.md — "não criar uma segunda escala de risco em
  -- paralelo", severity.md). Cada fator coalesce(..., 50) quando não há
  -- sinal pro escopo/janela (50 = neutro, mesma convenção de norm_growth).
  --
  -- Envolvida num bloco begin/exception (savepoint implícito): uma falha
  -- aqui (ex: uma query lenta estourando statement_timeout, exatamente o
  -- bug de produção que 20260803000000 corrigiu na raiz via 2 índices) não
  -- pode mais desfazer a 1.1/1.2 já commitadas nesta mesma invocação — só
  -- pula a atualização de severidade deste ciclo, loga um aviso, e segue
  -- pra 1.6.
  begin
    update radar_staging_events e
    set
      severity_score = f.severity_score,
      severity = case
        when f.severity_score >= 85 then 'critical'::severity_level
        when f.severity_score >= 60 then 'high'::severity_level
        when f.severity_score >= 34 then 'medium'::severity_level
        else 'low'::severity_level
      end
    from (
      select
        e2.id,
        round(
          0.20 * coalesce(event_radar_volume_severity(e2.organization_id, e2.scope_type, e2.scope_id), 50) +
          0.20 * coalesce(event_radar_sentiment_severity(e2.organization_id, e2.scope_type, e2.scope_id), 50) +
          0.20 * coalesce(event_radar_velocity_severity(e2.organization_id, e2.scope_type, e2.scope_id, e2.event_type, e2.metric_value), 50) +
          0.15 * coalesce(event_radar_reach_engagement_severity(e2.organization_id, e2.scope_type, e2.scope_id), 50) +
          0.10 * coalesce(event_radar_author_influence_severity(e2.organization_id, e2.scope_type, e2.scope_id), 50) +
          0.10 * coalesce(event_radar_related_narrative_risk(e2.organization_id, e2.scope_type, e2.scope_id), 50) +
          0.05 * least(100, greatest(0,
            extract(epoch from (v_cycle_start - e2.created_at)) / 3600.0 * (100.0 / 24)
          ))
        ) as severity_score
      from radar_staging_events e2
      where e2.closed_at is null
    ) f
    where e.id = f.id;

    -- Espelha severity_score/severity no feed_events vinculado, enquanto o
    -- evento continua ativo (aggregated-metrics: A2, "risk_score =
    -- greatest(risk_score calculado, severity_score do evento ativo)",
    -- precisa ler um severity_score sempre atual em feed_events).
    update feed_events fe
    set
      severity_score = e5.severity_score,
      severity = e5.severity
    from radar_staging_events e5
    where fe.radar_staging_event_id = e5.id
      and e5.closed_at is null
      and (
        fe.severity_score is distinct from e5.severity_score
        or fe.severity is distinct from e5.severity
      );
  exception
    when others then
      raise warning '[event_radar] severity computation failed this cycle, skipping: % (%)', sqlerrm, sqlstate;
  end;

  -- 1.6 volume-limits — cap diário de eventos "enfileirados pra IA" por
  -- organização (overview.md, "Ordem de implementação": entra como filtro
  -- entre 1.3 e 1.4, não depois de 1.4 apesar do número "1.6" sugerir o
  -- contrário — 1.4 já assume "dentro do cap diário" como pré-condição).
  -- already_queued conta, por organização, quantos eventos ativos já
  -- foram marcados hoje (UTC, mesma convenção de todo grão diário deste
  -- projeto); candidates classifica por severity_score os ainda não
  -- marcados hoje (severity_score pode estar stale/null se o bloco acima
  -- falhou neste ciclo — `nulls last` já tolera isso); só os primeiros N
  -- (cap - já marcados) são marcados nesta passada. Um evento marcado
  -- permanece marcado mesmo que seu severity_score mude depois — não
  -- desmarca.
  with already_queued as (
    select organization_id, count(*) as cnt
    from radar_staging_events
    where closed_at is null
      and queued_for_agent_at is not null
      and queued_for_agent_at >= date_trunc('day', v_cycle_start)
    group by organization_id
  ),
  candidates as (
    select
      e3.id,
      e3.organization_id,
      row_number() over (
        partition by e3.organization_id
        order by e3.severity_score desc nulls last, e3.detected_at asc
      ) as rn
    from radar_staging_events e3
    where e3.closed_at is null
      and (
        e3.queued_for_agent_at is null
        or e3.queued_for_agent_at < date_trunc('day', v_cycle_start)
      )
  )
  update radar_staging_events e
  set queued_for_agent_at = v_cycle_start
  from candidates c
  left join already_queued aq on aq.organization_id = c.organization_id
  where e.id = c.id
    and c.rn <= (v_config.daily_event_cap - coalesce(aq.cnt, 0));
end;
$$;
