-- event-radar 1.3 — severity (SQL, sem IA).
-- Implementa .dev/specs/event-radar/severity.md — score contínuo 0-100
-- por evento ativo + mapeamento pra severity_level (mesmo enum/faixas de
-- risk_score, aggregated-metrics/sql-aggregation.md — "não criar uma
-- segunda escala de risco em paralelo à já existente no schema").
--
-- ⚠️ Nenhuma fórmula exata é dada em severity.md, só os 7 pesos (Volume
-- 20%, Sentimento 20%, Velocidade 20%, Alcance/engajamento 15%, Relevância
-- dos autores 10%, Risco da narrativa relacionada 10%, Persistência 5%).
-- As fórmulas por fator abaixo são inferência de MVP, documentada por
-- fator — mesmo padrão já usado em 1.1 (thresholds) e no cálculo de
-- Tendência (regr_slope) de `aggregated-metrics`. Cada fator retorna
-- `null` quando não há sinal pro escopo (ex: `platform` não tem breakdown
-- de autores nem narrativa relacionada) — o chamador faz
-- `coalesce(fator, 50)` (50 = neutro, mesma convenção de `norm_growth`).
--
-- Desenho: 1.3 é anexado dentro do próprio `run_event_detection()` (mais
-- um `CREATE OR REPLACE`, não uma função/pg_cron separado), pela mesma
-- razão que 1.2 foi: rodar como job separado no mesmo cron de 15min não
-- garante ordem entre os dois (dois jobs agendados pro mesmo horário
-- podem disparar em qualquer ordem), o que deixaria severity até 15min
-- desatualizada em relação à detecção/fechamento mais recentes — evitável
-- sem custo real, já que 1.3 só roda DEPOIS que 1.1/1.2 já gravaram nesta
-- mesma transação.

-- =========================================================================
-- Fator Volume (20%) — |z-score| de volume (hora atual vs. média de 4
-- semanas, já calculado por 1.1) escalado pra 0-100 (z=3 → 100, mesma
-- banda "relevante" já fixada em detection-engine.md). Só existe pra
-- query/narrative (única combinação com grão horário). Fallback pra
-- platform (e pra quando o z-score não tem histórico suficiente):
-- variação percentual da janela de 3 dias, escalada (±100% → 100).
-- =========================================================================

create or replace function event_radar_volume_severity(
  p_organization_id uuid,
  p_scope_type text,
  p_scope_id text
)
returns numeric
language sql
stable
as $$
  select coalesce(
    (
      select least(100, abs(z.volume_z_score) * 100.0 / 3)
      from event_radar_hourly_zscore(p_organization_id) z
      where z.scope_type = p_scope_type
        and z.scope_id = p_scope_id
        and z.volume_z_score is not null
    ),
    (
      select least(100, abs(event_radar_delta_pct(d.current_volume, d.previous_volume)))
      from event_radar_daily_range(
        p_organization_id, current_date - 2, current_date, current_date - 5, current_date - 3
      ) d
      where d.scope_type = p_scope_type
        and d.scope_id = p_scope_id
        and event_radar_delta_pct(d.current_volume, d.previous_volume) is not null
    )
  )
$$;

-- =========================================================================
-- Fator Sentimento (20%) — mesmo desenho do Volume, mas sobre
-- `negative_share` (|z-score| da hora atual vs. média de 4 semanas,
-- fallback pra variação de 3 dias escalada — 30 pontos percentuais de
-- variação → 100, escala arbitrária de MVP). `platform` nunca tem
-- `negative_share` (sem breakdown positivo/neutro/negativo na fonte, ver
-- `event_radar_daily_series`) — retorna `null` pra esse escopo, sem
-- fallback possível.
-- =========================================================================

create or replace function event_radar_sentiment_severity(
  p_organization_id uuid,
  p_scope_type text,
  p_scope_id text
)
returns numeric
language sql
stable
as $$
  select coalesce(
    (
      select least(100, abs(z.negative_share_z_score) * 100.0 / 3)
      from event_radar_hourly_zscore(p_organization_id) z
      where z.scope_type = p_scope_type
        and z.scope_id = p_scope_id
        and z.negative_share_z_score is not null
    ),
    (
      select least(100, abs(d.current_negative_share - d.previous_negative_share) * 100.0 / 30)
      from event_radar_daily_range(
        p_organization_id, current_date - 2, current_date, current_date - 5, current_date - 3
      ) d
      where d.scope_type = p_scope_type
        and d.scope_id = p_scope_id
        and d.current_negative_share is not null
        and d.previous_negative_share is not null
    )
  )
$$;

-- =========================================================================
-- Fator Velocidade (20%) — "rapidez de escalada do evento" (janela curta,
-- distinta da regressão de 14 dias da Tendência de Narrativa — ver a nota
-- de 2026-07-22 em severity.md, "Relação com risk_score"): variação
-- percentual de volume nas últimas 3h vs. 3h anteriores (mesma janela e
-- mesma função já usadas pela regra `volume_spike`/`volume_drop` de "3h"
-- em 1.1), escalada (±100% → 100). Só existe pra query/narrative — sem
-- grão horário pra `platform`.
-- =========================================================================

create or replace function event_radar_velocity_severity(
  p_organization_id uuid,
  p_scope_type text,
  p_scope_id text
)
returns numeric
language sql
stable
as $$
  select least(100, abs(event_radar_delta_pct(s.current_volume, s.previous_volume)))
  from event_radar_hourly_symmetric(p_organization_id, 3) s
  where s.scope_type = p_scope_type
    and s.scope_id = p_scope_id
$$;

-- =========================================================================
-- Fator Alcance/engajamento (15%) — percentil do dia mais recente
-- disponível para o escopo, relativo ao máximo entre os pares do mesmo
-- tipo na mesma organização (mesmo princípio do `reach_risk`/`impact_risk`
-- de `risk_score`, aggregated-metrics/sql-aggregation.md, só que
-- comparando contra todos os pares da organização, não só os da mesma
-- Query — este módulo não tem o conceito de "narrativas da mesma Query"
-- centralizado como aquela function). `narrative`: `reach_estimated`
-- (`narrative_metrics`). `query`: `reach_estimate` (`bw_query_metrics_daily`,
-- linha da Query inteira). `platform`: `engagement_score`
-- (`bw_query_metrics_daily_by_platform` não tem reach). plpgsql (não SQL
-- puro) pelo dispatch por `p_scope_type` com múltiplas queries por ramo —
-- mais legível que aninhar tudo em CTEs/CASE.
-- =========================================================================

create or replace function event_radar_reach_engagement_severity(
  p_organization_id uuid,
  p_scope_type text,
  p_scope_id text
)
returns numeric
language plpgsql
stable
as $$
declare
  v_value numeric;
  v_max numeric;
begin
  if p_scope_type = 'narrative' then
    select nm.reach_estimated into v_value
    from narrative_metrics nm
    join narratives n on n.id = nm.narrative_id
    where n.id = p_scope_id::uuid
      and n.organization_id = p_organization_id
      and nm.source = 'bw_aggregate'
      and nm.metric_date = (
        select max(metric_date) from narrative_metrics where narrative_id = n.id
      );

    select max(nm.reach_estimated) into v_max
    from narrative_metrics nm
    join narratives n on n.id = nm.narrative_id
    join bw_categories bc on bc.id = n.bw_category_id
    where n.organization_id = p_organization_id
      and bc.status = 'active'
      and nm.source = 'bw_aggregate'
      and nm.metric_date = (
        select max(metric_date) from narrative_metrics where narrative_id = nm.narrative_id
      );

  elsif p_scope_type = 'query' then
    select d.reach_estimate into v_value
    from bw_query_metrics_daily d
    join bw_queries q on q.id = d.query_id
    join bw_projects bp on bp.id = q.project_id
    where d.query_id = p_scope_id::bigint
      and bp.organization_id = p_organization_id
      and d.category_id is null
      and d.metric_date = (
        select max(metric_date) from bw_query_metrics_daily
        where query_id = d.query_id and category_id is null
      );

    select max(d.reach_estimate) into v_max
    from bw_query_metrics_daily d
    join bw_queries q on q.id = d.query_id
    join bw_projects bp on bp.id = q.project_id
    where bp.organization_id = p_organization_id
      and d.category_id is null
      and d.metric_date = (
        select max(metric_date) from bw_query_metrics_daily d2
        where d2.query_id = d.query_id and d2.category_id is null
      );

  elsif p_scope_type = 'platform' then
    select pd.engagement_score into v_value
    from bw_query_metrics_daily_by_platform pd
    join bw_queries q on q.id = pd.query_id
    join bw_projects bp on bp.id = q.project_id
    where pd.page_type = p_scope_id
      and bp.organization_id = p_organization_id
      and pd.category_id is null
      and pd.metric_date = (
        select max(metric_date) from bw_query_metrics_daily_by_platform
        where query_id = pd.query_id and page_type = pd.page_type and category_id is null
      );

    select max(pd.engagement_score) into v_max
    from bw_query_metrics_daily_by_platform pd
    join bw_queries q on q.id = pd.query_id
    join bw_projects bp on bp.id = q.project_id
    where bp.organization_id = p_organization_id
      and pd.category_id is null
      and pd.metric_date = (
        select max(metric_date) from bw_query_metrics_daily_by_platform pd2
        where pd2.query_id = pd.query_id and pd2.page_type = pd.page_type and pd2.category_id is null
      );
  end if;

  if v_value is null or v_max is null or v_max <= 0 then
    return null;
  end if;

  return least(100, v_value * 100.0 / v_max);
end;
$$;

-- =========================================================================
-- Fator Relevância dos autores envolvidos (10%) — % dos Top Authors
-- (semana mais recente sincronizada) que são `is_influential` (nativo,
-- followers >= 100k — mesmo campo/mesma fórmula do `author_influence` de
-- `risk_score`). `narrative`: filtra `bw_query_top_authors.category_id`
-- pelo `bw_category_id` da Narrativa. `query`: `category_id is null`
-- (Query inteira). `platform`: sem breakdown de autores por plataforma —
-- retorna `null`.
-- =========================================================================

create or replace function event_radar_author_influence_severity(
  p_organization_id uuid,
  p_scope_type text,
  p_scope_id text
)
returns numeric
language plpgsql
stable
as $$
declare
  v_query_id bigint;
  v_category_id bigint;
  v_week date;
  v_total integer;
  v_influential integer;
begin
  if p_scope_type = 'narrative' then
    select n.bw_category_id into v_category_id
    from narratives n
    where n.id = p_scope_id::uuid and n.organization_id = p_organization_id;

    if v_category_id is null then
      return null;
    end if;

    select max(a.metric_week) into v_week
    from bw_query_top_authors a
    join bw_queries q on q.id = a.query_id
    join bw_projects bp on bp.id = q.project_id
    where bp.organization_id = p_organization_id
      and a.category_id = v_category_id;

    select count(*), count(*) filter (where a.is_influential)
      into v_total, v_influential
    from bw_query_top_authors a
    join bw_queries q on q.id = a.query_id
    join bw_projects bp on bp.id = q.project_id
    where bp.organization_id = p_organization_id
      and a.category_id = v_category_id
      and a.metric_week = v_week;

  elsif p_scope_type = 'query' then
    v_query_id := p_scope_id::bigint;

    select max(a.metric_week) into v_week
    from bw_query_top_authors a
    join bw_queries q on q.id = a.query_id
    join bw_projects bp on bp.id = q.project_id
    where a.query_id = v_query_id
      and a.category_id is null
      and bp.organization_id = p_organization_id;

    select count(*), count(*) filter (where a.is_influential)
      into v_total, v_influential
    from bw_query_top_authors a
    where a.query_id = v_query_id
      and a.category_id is null
      and a.metric_week = v_week;

  else
    return null;
  end if;

  if v_total is null or v_total = 0 then
    return null;
  end if;

  return v_influential * 100.0 / v_total;
end;
$$;

-- =========================================================================
-- Fator Risco da narrativa relacionada (10%) — só existe pra `scope_type
-- = 'narrative'` (não há "uma" narrativa relacionada a um evento de
-- escopo `query`/`platform`, que já são agregados de várias Narrativas).
-- Reaproveita `get_narratives_table` (aggregated-metrics/sql-aggregation.md)
-- filtrando pela Narrativa via `p_filters->'narratives'`, mesmo shape já
-- usado pelo resto do produto — não recalcula `risk_score` aqui.
-- =========================================================================

create or replace function event_radar_related_narrative_risk(
  p_organization_id uuid,
  p_scope_type text,
  p_scope_id text
)
returns numeric
language plpgsql
stable
as $$
declare
  v_risk numeric;
begin
  if p_scope_type <> 'narrative' then
    return null;
  end if;

  select risk_score into v_risk
  from get_narratives_table(
    p_organization_id,
    current_date - 6,
    current_date,
    jsonb_build_object('narratives', jsonb_build_array(p_scope_id)),
    null,
    null,
    now()
  );

  return v_risk;
end;
$$;

-- =========================================================================
-- run_event_detection() — CREATE OR REPLACE, corpo idêntico ao de
-- 20260728000000 (1.1 + 1.2) mais o bloco de severidade (1.3) anexado ao
-- final, antes de `end;`. Ver comentário no bloco abaixo pro porquê de
-- estar na mesma função em vez de um pg_cron separado.
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

  -- Hoje vs. mesmo dia da semana passada (volume) — todos os escopos,
  -- incl. platform (único a cobrir esse escopo além de "3d").
  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, delta_pct, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'volume_spike', 'today_vs_last_week',
    w.current_volume, w.previous_volume,
    event_radar_delta_pct(w.current_volume, w.previous_volume),
    v_cycle_start
  from organizations o
  cross join lateral event_radar_daily_range(
    o.id, current_date, current_date, current_date - 7, current_date - 7
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
    o.id, w.scope_type, w.scope_id, 'volume_drop', 'today_vs_last_week',
    w.current_volume, w.previous_volume,
    event_radar_delta_pct(w.current_volume, w.previous_volume),
    v_cycle_start
  from organizations o
  cross join lateral event_radar_daily_range(
    o.id, current_date, current_date, current_date - 7, current_date - 7
  ) w
  where w.previous_volume >= v_config.min_volume
    and event_radar_delta_pct(w.current_volume, w.previous_volume) <= v_config.drop_pct
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    delta_pct = excluded.delta_pct,
    detected_at = excluded.detected_at;

  -- Últimos 3 dias vs. 3 dias imediatamente anteriores (volume) — todos os
  -- escopos.
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
    o.id, current_date - 2, current_date, current_date - 5, current_date - 3
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
    o.id, current_date - 2, current_date, current_date - 5, current_date - 3
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
  -- banda exata (atenção/relevante) vira severity só na etapa 1.3.
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

  -- 1.2 deduplication-grouping — "quando o indicador volta ao normal":
  -- toda regra acima é reavaliada por completo a cada ciclo (sem execução
  -- faseada, diferente de bw-sync) — se uma linha ativa não foi atualizada
  -- neste ciclo (detected_at ainda no valor de um ciclo anterior a
  -- v_cycle_start), a regra que a originou deixou de disparar. Fecha aqui,
  -- não numa função/step separado — encerramento depende exatamente da
  -- mesma matriz de regras já calculada acima, recalculá-la de novo numa
  -- função à parte seria dobrar o custo de leitura sem necessidade.
  update radar_staging_events
  set closed_at = v_cycle_start
  where closed_at is null
    and detected_at < v_cycle_start;

  -- 1.3 severity — score contínuo 0-100 sobre os eventos ativos (saída de
  -- 1.2, já calculada acima nesta mesma função) + mapeamento pra
  -- severity_level (mesmas 4 faixas de risk_score, aggregated-metrics/
  -- sql-aggregation.md — "não criar uma segunda escala de risco em
  -- paralelo", severity.md). Cada fator coalesce(..., 50) quando não há
  -- sinal pro escopo/janela (50 = neutro, mesma convenção de norm_growth).
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
        0.20 * coalesce(event_radar_velocity_severity(e2.organization_id, e2.scope_type, e2.scope_id), 50) +
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
end;
$$;
