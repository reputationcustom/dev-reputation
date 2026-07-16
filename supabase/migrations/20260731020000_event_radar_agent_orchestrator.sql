-- event-radar 1.4 — agent-orchestrator (única chamada de IA por evento).
-- Implementa .dev/specs/event-radar/agent-orchestrator.md — a única etapa
-- deste módulo que faz chamada de IA. Grava a saída em `feed_events`
-- (schema-integration.md, "Fluxo principal" item 1) — essa tabela nunca
-- tinha migration ainda; esta é a primeira vez que ela é criada.
--
-- ⚠️ `feed_event_type` e `feed_events` só existiam documentados em
-- `_glossary.md`/`data-model.md`, nunca migrados — este arquivo é quem
-- materializa o schema pela primeira vez.
--
-- ⚠️ Coluna nova, não antecipada em `data-model.md`:
-- `feed_events.radar_staging_event_id` — sem ela não haveria como
-- implementar "closed_at espelha radar_staging_events.closed_at" (a própria
-- frase do data-model.md), que exige saber qual `feed_events` row veio de
-- qual `radar_staging_events` row.
--
-- ⚠️ Coluna nova em `radar_staging_events`: `agent_processed_at` — marca
-- que a IA já rodou pra este evento (`should_publish` true ou false, tanto
-- faz — o que importa é nunca chamar duas vezes, "única chamada de IA por
-- evento"). Distinta de `queued_for_agent_at` (1.6, "está dentro do cap
-- diário") — um evento pode estar `queued` sem ainda estar `processed`
-- (aguardando a Edge Function rodar), nunca o contrário.

-- =========================================================================
-- 1. feed_event_type + feed_events (data-model.md)
-- =========================================================================

create type feed_event_type as enum (
  'narrative_detected',
  'threshold_triggered',
  'case_created',
  'case_status_changed',
  'note_published',
  'sentiment_changed',
  'new_entity_detected'
);

create table if not exists feed_events (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id) on delete cascade,
  radar_staging_event_id uuid references radar_staging_events(id) on delete set null,
  type                   feed_event_type not null,
  event_type             text,
  severity               severity_level,
  severity_score         numeric,
  severity_explanation   text,
  title                  text not null,
  description            text not null,
  summary                text not null,
  recommendation         text,
  confidence             numeric,
  tags                   text[],
  related_narrative_id   uuid references narratives(id) on delete set null,
  related_entity_id      uuid,
  closed_at              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on column feed_events.severity_explanation is
  'Coluna nova, não antecipada em data-model.md — agent-orchestrator.md, "Schema de saída", exige severity_explanation como campo obrigatório da IA ("por que essa severidade, em linguagem natural"), distinto de description/explanation (causa provável do evento em si).';

create index if not exists idx_feed_events_organization_id on feed_events(organization_id);
create index if not exists idx_feed_events_radar_staging_event_id
  on feed_events(radar_staging_event_id) where radar_staging_event_id is not null;

create trigger set_updated_at
  before update on feed_events
  for each row execute function set_updated_at();

-- Leitura para authenticated escopada por organização (é assim que uma
-- futura get_active_highlights, chamada pelas Edge Functions get-page-*
-- com o JWT do usuário, consegue ler sem bypassar RLS — mesmo padrão já
-- usado por aggregated-metrics). Sem policy de INSERT/UPDATE/DELETE pra
-- authenticated — só SUPABASE_SECRET_KEY (esta Edge Function) escreve,
-- mesmo padrão de toda tabela gravada exclusivamente por job de backend
-- neste projeto (ex: bw_query_metrics_daily).
alter table feed_events enable row level security;

create policy "feed_events_select_org"
  on feed_events for select
  using (organization_id in (select auth_organization_ids()));

-- =========================================================================
-- 2. radar_staging_events.agent_processed_at
-- =========================================================================

alter table radar_staging_events
  add column if not exists agent_processed_at timestamptz;

comment on column radar_staging_events.agent_processed_at is
  'Marcado pela Edge Function event-radar-agent-orchestrator (1.4) depois da única chamada de IA por evento — should_publish true ou false, tanto faz. Nunca reprocessar um evento com esta coluna preenchida.';

-- =========================================================================
-- run_event_detection() — CREATE OR REPLACE, corpo idêntico ao de
-- 20260730000000 (1.1 + 1.2 + 1.3 + 1.6) mais uma linha no bloco de
-- encerramento (1.2): quando um radar_staging_events fecha, o feed_events
-- vinculado (se existir) fecha junto — "closed_at espelha", data-model.md.
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

  -- 1.6 volume-limits — cap diário de eventos "enfileirados pra IA" por
  -- organização (overview.md, "Ordem de implementação": entra como filtro
  -- entre 1.3 e 1.4, não depois de 1.4 apesar do número "1.6" sugerir o
  -- contrário — 1.4 ainda não existe, mas seu próprio spec já assume
  -- "dentro do cap diário" como pré-condição, ver agent-orchestrator.md).
  -- already_queued conta, por organização, quantos eventos ativos já
  -- foram marcados hoje (UTC, mesma convenção de todo grão diário deste
  -- projeto); candidates classifica por severity_score os ainda não
  -- marcados hoje; só os primeiros N (cap - já marcados) são marcados
  -- nesta passada. Um evento marcado permanece marcado mesmo que seu
  -- severity_score mude depois — não desmarca.
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

-- =========================================================================
-- 3. event_radar_build_agent_payload — monta o payload agregado que a
-- Edge Function envia à IA (nunca texto bruto de mentions — só métricas já
-- calculadas, top tópicos com percentuais, principais plataformas,
-- contagens de autores, agent-orchestrator.md "Regras de negócio").
-- =========================================================================

create or replace function event_radar_build_agent_payload(p_event_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_event radar_staging_events%rowtype;
  v_scope_label text;
  v_category_id bigint;
  v_query_id bigint;
  v_topics jsonb;
  v_platforms jsonb;
  v_authors jsonb;
  v_author_count integer;
  v_sibling_events jsonb;
  v_recent_related_cards jsonb;
begin
  select * into v_event from radar_staging_events where id = p_event_id;
  if not found then
    return null;
  end if;

  if v_event.scope_type = 'narrative' then
    select n.title, n.bw_category_id into v_scope_label, v_category_id
    from narratives n where n.id = v_event.scope_id::uuid;

    select coalesce(jsonb_agg(jsonb_build_object(
        'label', t.label, 'type', t.topic_type, 'volume', t.volume, 'trending', t.trending
      ) order by t.volume desc), '[]'::jsonb)
      into v_topics
    from (
      select label, topic_type, volume, trending
      from bw_query_topics
      where category_id = v_category_id
        and metric_week = (
          select max(metric_week) from bw_query_topics where category_id = v_category_id
        )
      order by volume desc
      limit 5
    ) t;

    select coalesce(jsonb_agg(jsonb_build_object(
        'platform', p.page_type, 'total_mentions', p.total_mentions
      ) order by p.total_mentions desc), '[]'::jsonb)
      into v_platforms
    from (
      select page_type, total_mentions
      from bw_query_metrics_daily_by_platform
      where category_id = v_category_id
        and metric_date = (
          select max(metric_date) from bw_query_metrics_daily_by_platform where category_id = v_category_id
        )
      order by total_mentions desc
      limit 3
    ) p;

    select count(*), coalesce(jsonb_agg(jsonb_build_object(
        'author', a.author, 'volume', a.volume
      ) order by a.volume desc), '[]'::jsonb)
      into v_author_count, v_authors
    from (
      select author, volume
      from bw_query_top_authors
      where category_id = v_category_id
        and metric_week = (
          select max(metric_week) from bw_query_top_authors where category_id = v_category_id
        )
      order by volume desc
      limit 3
    ) a;

  elsif v_event.scope_type = 'query' then
    v_query_id := v_event.scope_id::bigint;
    select name into v_scope_label from bw_queries where id = v_query_id;

    select coalesce(jsonb_agg(jsonb_build_object(
        'label', t.label, 'type', t.topic_type, 'volume', t.volume, 'trending', t.trending
      ) order by t.volume desc), '[]'::jsonb)
      into v_topics
    from (
      select label, topic_type, volume, trending
      from bw_query_topics
      where query_id = v_query_id and category_id is null
        and metric_week = (
          select max(metric_week) from bw_query_topics where query_id = v_query_id and category_id is null
        )
      order by volume desc
      limit 5
    ) t;

    select coalesce(jsonb_agg(jsonb_build_object(
        'platform', p.page_type, 'total_mentions', p.total_mentions
      ) order by p.total_mentions desc), '[]'::jsonb)
      into v_platforms
    from (
      select page_type, total_mentions
      from bw_query_metrics_daily_by_platform
      where query_id = v_query_id and category_id is null
        and metric_date = (
          select max(metric_date) from bw_query_metrics_daily_by_platform
          where query_id = v_query_id and category_id is null
        )
      order by total_mentions desc
      limit 3
    ) p;

    select count(*), coalesce(jsonb_agg(jsonb_build_object(
        'author', a.author, 'volume', a.volume
      ) order by a.volume desc), '[]'::jsonb)
      into v_author_count, v_authors
    from (
      select author, volume
      from bw_query_top_authors
      where query_id = v_query_id and category_id is null
        and metric_week = (
          select max(metric_week) from bw_query_top_authors
          where query_id = v_query_id and category_id is null
        )
      order by volume desc
      limit 3
    ) a;

  else
    -- platform: sem breakdown de tópicos/autores por plataforma na fonte
    -- (mesmo gap honesto documentado em 1.3) — payload fica só com as
    -- métricas do próprio evento.
    v_scope_label := v_event.scope_id;
    v_topics := '[]'::jsonb;
    v_platforms := '[]'::jsonb;
    v_authors := '[]'::jsonb;
    v_author_count := 0;
  end if;

  -- Dedup semântico (agent-orchestrator.md, "Regras de negócio") — a única
  -- parte desta etapa que exige julgamento de IA. Sem um jeito de mandar
  -- vários eventos simultâneos pro mesmo prompt (o desenho é uma chamada
  -- por evento), o contexto que dá à IA condição de reconhecer "isso já é
  -- a mesma história" é: (a) outros eventos ativos no mesmo escopo agora
  -- (sibling_events, todos os 3 escopos), e (b) cards já publicados nas
  -- últimas 24h pra mesma Narrativa (recent_related_cards, só escopo
  -- narrative — feed_events não tem uma coluna própria de scope_id, só
  -- related_narrative_id).
  select coalesce(jsonb_agg(jsonb_build_object(
      'event_type', s.event_type, 'window', s."window",
      'metric_value', s.metric_value, 'comparison_value', s.comparison_value,
      'delta_pct', s.delta_pct
    )), '[]'::jsonb)
    into v_sibling_events
  from radar_staging_events s
  where s.organization_id = v_event.organization_id
    and s.scope_type = v_event.scope_type
    and s.scope_id = v_event.scope_id
    and s.id <> v_event.id
    and s.closed_at is null;

  if v_event.scope_type = 'narrative' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'event_type', fe.event_type, 'title', fe.title, 'summary', fe.summary,
        'created_at', fe.created_at
      ) order by fe.created_at desc), '[]'::jsonb)
      into v_recent_related_cards
    from feed_events fe
    where fe.related_narrative_id = v_event.scope_id::uuid
      and fe.created_at >= v_event.detected_at - interval '24 hours';
  else
    v_recent_related_cards := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'scope_type', v_event.scope_type,
    'scope_label', v_scope_label,
    'event_type', v_event.event_type,
    'window', v_event."window",
    'metric_value', v_event.metric_value,
    'comparison_value', v_event.comparison_value,
    'delta_pct', v_event.delta_pct,
    'z_score', v_event.z_score,
    'severity', v_event.severity,
    'severity_score', v_event.severity_score,
    'detected_at', v_event.detected_at,
    'top_topics', v_topics,
    'top_platforms', v_platforms,
    'author_count', v_author_count,
    'top_authors', v_authors,
    'sibling_events', v_sibling_events,
    'recent_related_cards', v_recent_related_cards
  );
end;
$$;

-- =========================================================================
-- 4. Agendamento — pg_cron a cada 15min, mesmo heartbeat/net.http_post de
--    bw-sync-heartbeat (única etapa deste módulo que chama uma API externa
--    — precisa de Edge Function, diferente de 1.1-1.3/1.6 que são SQL
--    puro). URL hardcoded — mesmo projeto Supabase único de sempre, não é
--    segredo (Princípio técnico 1 é sobre credenciais).
-- =========================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'event-radar-agent-orchestrator-heartbeat',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://ktvyqpogfnowuqmjybvu.supabase.co/functions/v1/event-radar-agent-orchestrator',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
