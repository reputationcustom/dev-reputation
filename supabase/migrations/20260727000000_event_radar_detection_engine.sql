-- event-radar 1.1 — detection-engine (100% SQL, sem chamada de IA).
-- Implementa .dev/specs/event-radar/detection-engine.md + a tabela
-- radar_staging_events de .dev/specs/event-radar/data-model.md — primeira
-- etapa do pipeline (1.1), a única implementada nesta migration. 1.2
-- (dedup/grouping), 1.3 (severity), 1.4 (agent-orchestrator), 1.5
-- (schema-integration) e 1.6 (volume-limits) continuam rascunho/não
-- implementadas — esta função só grava em radar_staging_events, nunca em
-- feed_events (que nem existe ainda).
--
-- ⚠️ data-model.md nomeia o tipo da coluna `severity` como "risk_level",
-- mas não existe um tipo chamado `risk_level` no schema — o enum real
-- reaproveitado por `narratives.risk_level` é `severity_level`
-- (low|medium|high|critical, foundation_schema.sql). Usado aqui; a
-- imprecisão de nome no texto do spec foi corrigida na atualização de
-- documentação desta mesma sessão (ver data-model.md).
--
-- ⚠️ Thresholds do MVP (percentual de pico/queda, volume mínimo, diferença
-- absoluta de sentimento negativo, bandas de z-score) não têm um número
-- exato definido em nenhum spec deste módulo — só a banda de z-score
-- (≥2 atenção, ≥3 relevante) é explícita. Os demais valores abaixo
-- (event_radar_config()) são uma inferência razoável para MVP, documentada
-- num único lugar para ser recalibrada com dado real de produção — mesmo
-- padrão já usado em `get_volume_trend` (granularidade) e no cálculo de
-- Tendência (regr_slope) em `aggregated-metrics/sql-aggregation.md`.
--
-- "window" é palavra reservada no parser do Postgres (window functions) —
-- toda referência à coluna homônima de radar_staging_events precisa ficar
-- entre aspas duplas (mesmo nome de coluna que data-model.md especifica).

-- =========================================================================
-- 1. radar_staging_events (data-model.md)
-- =========================================================================

create table if not exists radar_staging_events (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  scope_type        text not null check (scope_type in ('query', 'narrative', 'platform')),
  scope_id          text not null,
  event_type        text not null,
  "window"          text not null check ("window" in (
                      '3h', '24h', 'today_vs_last_week', 'current_hour_vs_4week_avg', '3d'
                    )),
  metric_value      numeric not null,
  comparison_value  numeric not null,
  delta_pct         numeric,
  z_score           numeric,
  detected_at       timestamptz not null default now(),
  severity_score    numeric,
  severity          severity_level,
  closed_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Chave de dedup para eventos "ativos" (ainda não fechados por 1.2) — um
-- evento fechado (closed_at preenchido) não conta para o unique, permitindo
-- reabrir a mesma combinação como uma linha nova no futuro.
create unique index if not exists radar_staging_events_active_key
  on radar_staging_events (organization_id, scope_type, scope_id, event_type, "window")
  where closed_at is null;

create trigger set_updated_at
  before update on radar_staging_events
  for each row execute function set_updated_at();

-- Staging interno, nunca lido pelo frontend — mesmo padrão de
-- sync_cursors/bw_sync_lock/sync_log (CLAUDE.md, "Database security",
-- regra 3): deny-all, só SUPABASE_SECRET_KEY (funções de backend) acessa.
alter table radar_staging_events enable row level security;

create policy "radar_staging_events: sem acesso direto"
  on radar_staging_events for all
  using (false);

-- =========================================================================
-- 2. Config (thresholds do MVP, ver nota no topo do arquivo)
-- =========================================================================

create or replace function event_radar_config()
returns table (
  min_volume               integer,
  spike_pct                numeric,
  drop_pct                 numeric,
  net_sentiment_delta      numeric,
  negative_share_delta_pp  numeric,
  zscore_attention         numeric,
  zscore_relevant          numeric
)
language sql
immutable
as $$
  select
    20,     -- volume mínimo pra considerar um pico/queda relevante
    50,     -- variação percentual mínima pra volume_spike
    -50,    -- variação percentual máxima (negativa) pra volume_drop
    20,     -- variação mínima (pontos) de net_sentiment pra sentiment_change
    15,     -- diferença absoluta mínima (pontos percentuais) de share negativo
    2,      -- z-score mínimo — "atenção"
    3       -- z-score mínimo — "relevante"
$$;

-- Divisão percentual protegida por CASE (mesmo padrão de guarda usada por
-- `norm_growth`, aggregated-metrics/sql-aggregation.md) — nunca uma divisão
-- crua dependendo da ordem de avaliação de um AND na cláusula WHERE (o
-- Postgres não garante essa ordem; um CASE garante o short-circuit).
create or replace function event_radar_delta_pct(p_current numeric, p_previous numeric)
returns numeric
language sql
immutable
as $$
  select case when p_previous > 0
    then (p_current - p_previous) * 100.0 / p_previous
    else null end
$$;

-- =========================================================================
-- 3. Séries agregadas por escopo (query | narrative | platform)
--
-- Nunca lê `mentions` diretamente — só agregados oficiais já sincronizados
-- por foundation/sync-brandwatch (bw_query_metrics_hourly/daily/
-- daily_by_platform, narrative_metrics), conforme premissa do módulo
-- ("Dados envolvidos" em detection-engine.md).
--
-- net_sentiment/negative_share de query e narrative são derivados
-- localmente de sentiment_positive/negative/neutral (nunca lidos da coluna
-- oficial net_sentiment) — mesma escolha já adotada em
-- aggregated-metrics/sql-aggregation.md (migration 20260725060000) depois
-- de dois bugs reais de divergência entre o score oficial e o breakdown
-- positivo/neutro/negativo mostrado na mesma tela. Plataforma não tem
-- breakdown positivo/neutro/negativo (bw_query_metrics_daily_by_platform
-- só tem o score composto) — usa a coluna oficial net_sentiment mesmo,
-- e negative_share fica sempre null para esse escopo (gap honesto, não
-- inventado).
-- =========================================================================

create or replace function event_radar_hourly_series(p_organization_id uuid)
returns table (
  scope_type      text,
  scope_id        text,
  metric_hour     timestamptz,
  total_mentions  integer,
  net_sentiment   numeric,
  negative_share  numeric
)
language sql
stable
as $$
  select
    'query'::text,
    h.query_id::text,
    h.metric_hour,
    h.total_mentions,
    case when (h.sentiment_positive + h.sentiment_negative) > 0
      then (h.sentiment_positive - h.sentiment_negative) * 100.0 / (h.sentiment_positive + h.sentiment_negative)
      else null end,
    case when (h.sentiment_positive + h.sentiment_neutral + h.sentiment_negative) > 0
      then h.sentiment_negative * 100.0 / (h.sentiment_positive + h.sentiment_neutral + h.sentiment_negative)
      else null end
  from bw_query_metrics_hourly h
  join bw_queries q on q.id = h.query_id
  join bw_projects bp on bp.id = q.project_id
  where bp.organization_id = p_organization_id
    and h.category_id is null

  union all

  select
    'narrative'::text,
    n.id::text,
    h.metric_hour,
    h.total_mentions,
    case when (h.sentiment_positive + h.sentiment_negative) > 0
      then (h.sentiment_positive - h.sentiment_negative) * 100.0 / (h.sentiment_positive + h.sentiment_negative)
      else null end,
    case when (h.sentiment_positive + h.sentiment_neutral + h.sentiment_negative) > 0
      then h.sentiment_negative * 100.0 / (h.sentiment_positive + h.sentiment_neutral + h.sentiment_negative)
      else null end
  from bw_query_metrics_hourly h
  join bw_categories bc on bc.id = h.category_id
  join narratives n on n.bw_category_id = h.category_id
  where n.organization_id = p_organization_id
    and bc.status = 'active';
$$;

create or replace function event_radar_daily_series(p_organization_id uuid)
returns table (
  scope_type      text,
  scope_id        text,
  metric_date     date,
  total_mentions  integer,
  net_sentiment   numeric,
  negative_share  numeric
)
language sql
stable
as $$
  select
    'query'::text,
    d.query_id::text,
    d.metric_date,
    d.total_mentions,
    case when (d.sentiment_positive + d.sentiment_negative) > 0
      then (d.sentiment_positive - d.sentiment_negative) * 100.0 / (d.sentiment_positive + d.sentiment_negative)
      else null end,
    case when (d.sentiment_positive + d.sentiment_neutral + d.sentiment_negative) > 0
      then d.sentiment_negative * 100.0 / (d.sentiment_positive + d.sentiment_neutral + d.sentiment_negative)
      else null end
  from bw_query_metrics_daily d
  join bw_queries q on q.id = d.query_id
  join bw_projects bp on bp.id = q.project_id
  where bp.organization_id = p_organization_id
    and d.category_id is null

  union all

  select
    'narrative'::text,
    nm.narrative_id::text,
    nm.metric_date,
    nm.total_mentions,
    case when (nm.sentiment_positive + nm.sentiment_negative) > 0
      then (nm.sentiment_positive - nm.sentiment_negative) * 100.0 / (nm.sentiment_positive + nm.sentiment_negative)
      else null end,
    case when (nm.sentiment_positive + nm.sentiment_neutral + nm.sentiment_negative) > 0
      then nm.sentiment_negative * 100.0 / (nm.sentiment_positive + nm.sentiment_neutral + nm.sentiment_negative)
      else null end
  from narrative_metrics nm
  join narratives n on n.id = nm.narrative_id
  join bw_categories bc on bc.id = n.bw_category_id
  where n.organization_id = p_organization_id
    and nm.source = 'bw_aggregate'
    and bc.status = 'active'

  union all

  select
    'platform'::text,
    pd.page_type,
    pd.metric_date,
    pd.total_mentions,
    pd.net_sentiment,
    null::numeric
  from bw_query_metrics_daily_by_platform pd
  join bw_queries q on q.id = pd.query_id
  join bw_projects bp on bp.id = q.project_id
  where bp.organization_id = p_organization_id
    and pd.category_id is null;
$$;

-- =========================================================================
-- 4. Janelas de comparação sobre as séries acima
-- =========================================================================

-- "Últimas Nh vs. Nh imediatamente anteriores" — usa a série horária
-- (janela móvel de 30 dias já retida por bw_query_metrics_hourly). Cobre
-- as janelas "3h" e "24h" da tabela de detection-engine.md — só
-- query/narrative têm grão horário (não existe bw_query_metrics_hourly
-- por plataforma).
create or replace function event_radar_hourly_symmetric(
  p_organization_id uuid,
  p_window_hours integer
)
returns table (
  scope_type              text,
  scope_id                text,
  current_volume          numeric,
  previous_volume         numeric,
  current_net_sentiment   numeric,
  previous_net_sentiment  numeric,
  current_negative_share  numeric,
  previous_negative_share numeric
)
language sql
stable
as $$
  select
    scope_type,
    scope_id,
    sum(total_mentions) filter (
      where metric_hour >= now() - (p_window_hours::text || ' hours')::interval
    ),
    sum(total_mentions) filter (
      where metric_hour >= now() - ((p_window_hours * 2)::text || ' hours')::interval
        and metric_hour < now() - (p_window_hours::text || ' hours')::interval
    ),
    sum(net_sentiment * total_mentions) filter (
      where metric_hour >= now() - (p_window_hours::text || ' hours')::interval
    ) / nullif(sum(total_mentions) filter (
      where metric_hour >= now() - (p_window_hours::text || ' hours')::interval
    ), 0),
    sum(net_sentiment * total_mentions) filter (
      where metric_hour >= now() - ((p_window_hours * 2)::text || ' hours')::interval
        and metric_hour < now() - (p_window_hours::text || ' hours')::interval
    ) / nullif(sum(total_mentions) filter (
      where metric_hour >= now() - ((p_window_hours * 2)::text || ' hours')::interval
        and metric_hour < now() - (p_window_hours::text || ' hours')::interval
    ), 0),
    sum(negative_share * total_mentions) filter (
      where metric_hour >= now() - (p_window_hours::text || ' hours')::interval
    ) / nullif(sum(total_mentions) filter (
      where metric_hour >= now() - (p_window_hours::text || ' hours')::interval
        and negative_share is not null
    ), 0),
    sum(negative_share * total_mentions) filter (
      where metric_hour >= now() - ((p_window_hours * 2)::text || ' hours')::interval
        and metric_hour < now() - (p_window_hours::text || ' hours')::interval
    ) / nullif(sum(total_mentions) filter (
      where metric_hour >= now() - ((p_window_hours * 2)::text || ' hours')::interval
        and metric_hour < now() - (p_window_hours::text || ' hours')::interval
        and negative_share is not null
    ), 0)
  from event_radar_hourly_series(p_organization_id)
  group by scope_type, scope_id
$$;

-- Janelas de fronteira explícita por data (dia calendário) — cobre "Hoje
-- vs. mesmo dia da semana passada" e "Últimos 3 dias vs. 3 dias
-- imediatamente anteriores". Única das 3 janelas diárias/de fronteira que
-- também cobre o escopo `platform` (só existe grão diário por plataforma).
create or replace function event_radar_daily_range(
  p_organization_id uuid,
  p_current_start date,
  p_current_end date,
  p_comparison_start date,
  p_comparison_end date
)
returns table (
  scope_type              text,
  scope_id                text,
  current_volume          numeric,
  previous_volume         numeric,
  current_net_sentiment   numeric,
  previous_net_sentiment  numeric,
  current_negative_share  numeric,
  previous_negative_share numeric
)
language sql
stable
as $$
  select
    scope_type,
    scope_id,
    sum(total_mentions) filter (
      where metric_date between p_current_start and p_current_end
    ),
    sum(total_mentions) filter (
      where metric_date between p_comparison_start and p_comparison_end
    ),
    sum(net_sentiment * total_mentions) filter (
      where metric_date between p_current_start and p_current_end
    ) / nullif(sum(total_mentions) filter (
      where metric_date between p_current_start and p_current_end
    ), 0),
    sum(net_sentiment * total_mentions) filter (
      where metric_date between p_comparison_start and p_comparison_end
    ) / nullif(sum(total_mentions) filter (
      where metric_date between p_comparison_start and p_comparison_end
    ), 0),
    sum(negative_share * total_mentions) filter (
      where metric_date between p_current_start and p_current_end
    ) / nullif(sum(total_mentions) filter (
      where metric_date between p_current_start and p_current_end
        and negative_share is not null
    ), 0),
    sum(negative_share * total_mentions) filter (
      where metric_date between p_comparison_start and p_comparison_end
    ) / nullif(sum(total_mentions) filter (
      where metric_date between p_comparison_start and p_comparison_end
        and negative_share is not null
    ), 0)
  from event_radar_daily_series(p_organization_id)
  group by scope_type, scope_id
$$;

-- "Hora atual vs. média das últimas 4 semanas na mesma hora" — a única
-- janela baseada em z-score (detection-engine.md, "Regras de negócio").
-- "Hora atual" = a última hora já fechada (a hora corrente ainda está em
-- andamento, sem dado completo). Média/desvio-padrão calculados sobre as
-- ocorrências dessa mesma hora-do-dia nos últimos 28 dias, excluindo a
-- própria hora avaliada.
create or replace function event_radar_hourly_zscore(p_organization_id uuid)
returns table (
  scope_type              text,
  scope_id                text,
  current_volume          numeric,
  volume_mean             numeric,
  volume_stddev           numeric,
  volume_z_score          numeric,
  current_negative_share  numeric,
  negative_share_mean     numeric,
  negative_share_stddev   numeric,
  negative_share_z_score  numeric
)
language sql
stable
as $$
  with target_hour as (
    select date_trunc('hour', now()) - interval '1 hour' as metric_hour
  ),
  series as (
    select * from event_radar_hourly_series(p_organization_id)
  ),
  current_row as (
    select
      s.scope_type,
      s.scope_id,
      s.total_mentions::numeric as current_volume,
      s.negative_share as current_negative_share
    from series s, target_hour t
    where s.metric_hour = t.metric_hour
  ),
  baseline as (
    select
      s.scope_type,
      s.scope_id,
      avg(s.total_mentions) as volume_mean,
      stddev_samp(s.total_mentions) as volume_stddev,
      avg(s.negative_share) as negative_share_mean,
      stddev_samp(s.negative_share) as negative_share_stddev
    from series s, target_hour t
    where extract(hour from s.metric_hour at time zone 'utc')
        = extract(hour from t.metric_hour at time zone 'utc')
      and s.metric_hour <> t.metric_hour
      and s.metric_hour >= t.metric_hour - interval '28 days'
    group by s.scope_type, s.scope_id
  )
  select
    c.scope_type,
    c.scope_id,
    c.current_volume,
    b.volume_mean,
    b.volume_stddev,
    case when b.volume_stddev > 0
      then (c.current_volume - b.volume_mean) / b.volume_stddev
      else null end,
    c.current_negative_share,
    b.negative_share_mean,
    b.negative_share_stddev,
    case when b.negative_share_stddev > 0
      then (c.current_negative_share - b.negative_share_mean) / b.negative_share_stddev
      else null end
  from current_row c
  join baseline b using (scope_type, scope_id)
$$;

-- =========================================================================
-- 5. Orquestrador — aplica as regras de negócio e grava em
--    radar_staging_events (INSERT ... ON CONFLICT sobre a chave de dedup
--    "ativo" já definida na tabela — dedup real/agrupamento entre escopos
--    fica pra 1.2, esta etapa só evita duplicar a mesma combinação
--    organização+escopo+evento+janela enquanto ainda estiver ativa).
--
-- Mapeamento janela → regras aplicadas (nenhuma spec define exatamente
-- quais das 5 janelas cada event_type usa — escolha de MVP documentada
-- aqui, revisar com dado real de produção):
--   3h / 24h / today_vs_last_week / 3d -> volume_spike, volume_drop
--   24h                                 -> sentiment_change,
--                                          negative_sentiment_increase
--   current_hour_vs_4week_avg           -> volume_spike, volume_drop
--                                          (via z-score), negative_sentiment_spike
-- =========================================================================

create or replace function run_event_detection()
returns void
language plpgsql
as $$
declare
  v_config record;
begin
  select * into v_config from event_radar_config();

  -- 3h vs 3h anteriores (volume) — query/narrative apenas.
  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, delta_pct, detected_at
  )
  select
    o.id, w.scope_type, w.scope_id, 'volume_spike', '3h',
    w.current_volume, w.previous_volume,
    event_radar_delta_pct(w.current_volume, w.previous_volume),
    now()
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
    now()
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
    now()
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
    now()
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
    now()
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
    now()
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
    now()
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
    now()
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
    now()
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
    now()
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
    w.current_volume, w.volume_mean, w.volume_z_score, now()
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
    w.current_volume, w.volume_mean, w.volume_z_score, now()
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
    w.current_negative_share, w.negative_share_mean, w.negative_share_z_score, now()
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
end;
$$;

-- =========================================================================
-- 6. Agendamento — pg_cron a cada 15min (mesma cadência do heartbeat de
--    bw-sync, decisão do usuário resolvida em detection-engine.md,
--    2026-07-22). 100% SQL/Postgres, sem chamada à Brandwatch nem Edge
--    Function — mesmo padrão de refresh_narrative_metrics_hourly, não o
--    padrão net.http_post de bw-sync-heartbeat.
-- =========================================================================

create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'event_radar_detection_15min',
  '*/15 * * * *',
  $$select run_event_detection()$$
);
