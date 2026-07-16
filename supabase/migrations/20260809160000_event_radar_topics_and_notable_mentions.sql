-- event-radar — foco ampliado: hoje o motor de detecção (1.1) só olha
-- volume/sentimento (+ Momentum, via `momentum_spike`) — nunca "o quê"
-- está sendo falado, nem menções individuais de destaque. User request:
-- "acrescentar o foco nas trends, nos principais assuntos não só os que
-- estão categorizados, mas nos que possam estar fora das categorias
-- também... capturar de tempos em tempos algumas menções que estão no
-- top de engajamento (publicação, repost e comentário) e com maior
-- impacto... considerar somente as últimas 72h."
--
-- Decisões confirmadas com o usuário antes de implementar (AskUserQuestion):
-- 1) Assuntos emergentes reusam `bw_query_topics` já sincronizado (sem
--    chamada nova à Brandwatch) — não uma captura dedicada de 72h. O
--    pedido "somente as últimas 72h" é honrado como um GATE DE FRESCOR
--    sobre o snapshot já sincronizado (`synced_at >= now() - 72h`), não
--    como uma nova janela de data pedida à Brandwatch — se o snapshot
--    ficar mais velho que 72h (sync atrasado/`BW_SYNC_INTERVAL_HOURS`
--    alto), a organização simplesmente não gera candidatos até o próximo
--    sync, em vez de agir sobre dado stale.
-- 2) Menções de destaque viram cards completos via IA (mesmo pipeline de
--    severidade + agent-orchestrator já usado por volume/sentimento/
--    momentum) — não uma lista passiva.
-- 3) Assuntos emergentes só no escopo Query inteira (`bw_query_topics`
--    `category_id is null` — que já inclui qualquer assunto, esteja ele
--    mapeado a uma Narrativa ou não, pois cobre TODAS as menções da Query,
--    não só as categorizadas). Por consistência com essa mesma escolha
--    (não perguntado de novo, inferência documentada), menções de destaque
--    também são escopadas à organização inteira (todas as Queries), não
--    por Narrativa — evita multiplicar candidatos/chamadas de IA por
--    Narrativa.
--
-- Dois `event_type` novos: `emerging_topic` (scope_type novo `topic`,
-- scope_id = `<topic_type>:<label>`) e `notable_mention` (scope_type novo
-- `mention`, scope_id = `mentions.resource_id`). Nenhum dos dois é uma
-- violação da premissa "nunca somar/agregar `mentions` pra representar um
-- total" (2026-07-11) — `notable_mention` seleciona LINHAS INDIVIDUAIS já
-- sincronizadas (mesmo uso já sancionado por `full_text_enrichment`, que
-- já seleciona top-N mentions por `reach_estimate`), nunca soma/conta
-- sobre a amostra.
--
-- ⚠️ Achado real ao revisar a severidade existente, corrigido na mesma
-- migration: `event_radar_volume_severity`/`event_radar_sentiment_severity`
-- (20260729000000) tinham o MESMO bug de "hoje incompleto vs. dia
-- histórico fechado" já corrigido em `run_event_detection()` por
-- `20260809150000` — só que na PRÓPRIA fórmula de severidade (fallback
-- usado sempre que não há z-score horário, ou seja, SEMPRE para escopo
-- `platform`, que nunca tem grão horário). Isso nunca tinha sido corrigido
-- porque a correção anterior só tocou as janelas de DETECÇÃO
-- (`run_event_detection`), não as de SEVERIDADE (funções à parte, só
-- chamadas de dentro do bloco de severidade). Corrigido aqui com a mesma
-- janela de 3 dias completos (`current_date-3..current_date-1` vs.
-- `current_date-6..current_date-4`) — relevante agora porque os 2 novos
-- scope_type (`topic`/`mention`) vão cair no mesmo fallback sempre (não
-- têm grão horário), então valia a pena corrigir antes de multiplicar o
-- uso desse fallback.

-- =========================================================================
-- 1. CHECK constraints — scope_type ganha 'topic'/'mention'; window ganha
--    '72h' (usado pelos 2 novos event_type — não é uma janela de "delta",
--    é o gate de frescor/lookback descrito acima).
-- =========================================================================

alter table radar_staging_events
  drop constraint if exists radar_staging_events_scope_type_check;

alter table radar_staging_events
  add constraint radar_staging_events_scope_type_check
  check (scope_type in ('query', 'narrative', 'platform', 'topic', 'mention'));

alter table radar_staging_events
  drop constraint if exists radar_staging_events_window_check;

alter table radar_staging_events
  add constraint radar_staging_events_window_check
  check ("window" in (
    '3h', '24h', 'today_vs_last_week', 'current_hour_vs_4week_avg', '3d',
    '7d', '30d', '72h'
  ));

-- feed_event_type (enum) ganha 2 valores dedicados — nenhum dos 5 valores
-- já reservados (narrative_detected/case_created/case_status_changed/
-- note_published/new_entity_detected) cobre "um assunto emergente" ou "uma
-- menção individual de destaque" sem overload semântico (todos continuam
-- sem nenhum consumidor até hoje, confirmado por grep). Seguro adicionar
-- fora de uma transação que também os usa em DML (só usados depois, em
-- runtime, pela Edge Function) — não há INSERT nesta mesma migration
-- referenciando os valores novos.
alter type feed_event_type add value if not exists 'emerging_topic';
alter type feed_event_type add value if not exists 'notable_mention';

-- =========================================================================
-- 2. event_radar_config() ganha topic_trending_threshold/
--    notable_mentions_limit — precisa de DROP explícito (adicionar coluna
--    à saída de uma function RETURNS TABLE não é possível via CREATE OR
--    REPLACE puro).
-- =========================================================================

drop function if exists event_radar_config();

create function event_radar_config()
returns table (
  min_volume                integer,
  spike_pct                 numeric,
  drop_pct                  numeric,
  net_sentiment_delta       numeric,
  negative_share_delta_pp   numeric,
  zscore_attention           numeric,
  zscore_relevant            numeric,
  daily_event_cap            integer,
  momentum_spike_threshold   numeric,
  topic_trending_threshold   numeric,
  notable_mentions_limit     integer
)
language sql
immutable
as $$
  select
    20,     -- volume mínimo pra considerar um pico/queda relevante (reaproveitado como piso de volume de assunto emergente)
    50,     -- variação percentual mínima pra volume_spike
    -50,    -- variação percentual máxima (negativa) pra volume_drop
    20,     -- variação mínima (pontos) de net_sentiment pra sentiment_change
    15,     -- diferença absoluta mínima (pontos percentuais) de share negativo
    2,      -- z-score mínimo — "atenção"
    3,      -- z-score mínimo — "relevante"
    15,     -- cap diário de eventos "enfileirados pra IA" por organização
    80,     -- momentum_score mínimo pra momentum_spike — mesma faixa "Explosivo" já definida em aggregated-metrics/sql-aggregation.md
    50,     -- crescimento (trending) mínimo pra um assunto virar candidato a "emergente" — mesma escala assumida de spike_pct (percentual), não confirmado contra um payload real da Brandwatch
    5       -- quantas menções de destaque (top engajamento/impacto) considerar por ciclo
$$;

-- =========================================================================
-- 3. Fix real: janelas de severidade (Volume/Sentimento) excluindo "hoje"
--    incompleto — mesma correção já aplicada em run_event_detection() por
--    20260809150000, nunca replicada aqui até agora. Corpo idêntico ao de
--    20260729000000, só a chamada a event_radar_daily_range muda
--    (current_date-2..current_date -> current_date-3..current_date-1;
--    current_date-5..current_date-3 -> current_date-6..current_date-4).
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
        p_organization_id, current_date - 3, current_date - 1, current_date - 6, current_date - 4
      ) d
      where d.scope_type = p_scope_type
        and d.scope_id = p_scope_id
        and event_radar_delta_pct(d.current_volume, d.previous_volume) is not null
    )
  )
$$;

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
        p_organization_id, current_date - 3, current_date - 1, current_date - 6, current_date - 4
      ) d
      where d.scope_type = p_scope_type
        and d.scope_id = p_scope_id
        and d.current_negative_share is not null
        and d.previous_negative_share is not null
    )
  )
$$;

-- =========================================================================
-- 4. event_radar_reach_engagement_severity ganha 2 branches novos —
--    'topic' (volume do assunto relativo ao maior volume entre assuntos
--    frescos da organização) e 'mention' (reach_estimate da menção
--    relativo ao maior reach_estimate entre mentions das últimas 72h da
--    organização) — sem essas branches, os 2 novos scope_type sempre
--    cairiam no `coalesce(..., 50)` neutro do chamador, perdendo
--    diferenciação de severidade justamente no fator de maior peso (15%)
--    pra esses tipos de evento.
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
  v_topic_type text;
  v_label text;
  v_sep_pos integer;
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

  elsif p_scope_type = 'topic' then
    v_sep_pos := position(':' in p_scope_id);
    if v_sep_pos = 0 then
      return null;
    end if;
    v_topic_type := left(p_scope_id, v_sep_pos - 1);
    v_label := substring(p_scope_id from v_sep_pos + 1);

    select t.volume into v_value
    from bw_query_topics t
    join bw_queries q on q.id = t.query_id
    join bw_projects bp on bp.id = q.project_id
    where bp.organization_id = p_organization_id
      and t.category_id is null
      and t.topic_type = v_topic_type
      and t.label = v_label
      and t.synced_at >= now() - interval '72 hours'
    order by t.metric_week desc
    limit 1;

    select max(t.volume) into v_max
    from bw_query_topics t
    join bw_queries q on q.id = t.query_id
    join bw_projects bp on bp.id = q.project_id
    where bp.organization_id = p_organization_id
      and t.category_id is null
      and t.synced_at >= now() - interval '72 hours';

  elsif p_scope_type = 'mention' then
    -- mentions é particionada por mês (mention_date) — filtro explícito
    -- por mention_date (não só added) garante poda de partição real
    -- (mesma disciplina já usada por bw-sync, ex: full_text_enrichment),
    -- evitando o mesmo tipo de scan sem poda que já causou um statement
    -- timeout real em produção neste módulo (ver "run_event_detection()
    -- nunca gravava nada", 2026-08-03).
    select m.reach_estimate into v_value
    from mentions m
    join bw_queries q on q.id = m.query_id
    join bw_projects bp on bp.id = q.project_id
    where bp.organization_id = p_organization_id
      and m.resource_id = p_scope_id
      and m.mention_date >= current_date - 3
      and m.added >= now() - interval '72 hours'
    order by m.added desc
    limit 1;

    select max(m.reach_estimate) into v_max
    from mentions m
    join bw_queries q on q.id = m.query_id
    join bw_projects bp on bp.id = q.project_id
    where bp.organization_id = p_organization_id
      and m.mention_date >= current_date - 3
      and m.added >= now() - interval '72 hours';
  end if;

  if v_value is null or v_max is null or v_max <= 0 then
    return null;
  end if;

  return least(100, v_value * 100.0 / v_max);
end;
$$;

-- =========================================================================
-- 5. event_radar_emerging_topics — candidatos a "assunto emergente":
--    bw_query_topics já sincronizado, category_id is null (assunto da
--    Query inteira — inclui qualquer coisa, categorizada numa Narrativa
--    ou não, já que cobre TODAS as menções da Query), com synced_at
--    dentro das últimas 72h (gate de frescor, ver nota no topo do
--    arquivo). scope_id = 'topic_type:label' (evita colisão entre um
--    mesmo texto aparecendo como topic_type diferente).
-- =========================================================================

create or replace function event_radar_emerging_topics(p_organization_id uuid)
returns table (
  scope_id    text,
  topic_type  text,
  label       text,
  volume      integer,
  trending    numeric
)
language sql
stable
as $$
  with fresh as (
    select t.query_id, t.topic_type, t.label, t.volume, t.trending, t.metric_week
    from bw_query_topics t
    join bw_queries q on q.id = t.query_id
    join bw_projects bp on bp.id = q.project_id
    where bp.organization_id = p_organization_id
      and t.category_id is null
      and t.synced_at >= now() - interval '72 hours'
  ),
  latest as (
    select query_id, topic_type, label, max(metric_week) as latest_week
    from fresh
    group by query_id, topic_type, label
  )
  select distinct on (f.topic_type, f.label)
    f.topic_type || ':' || f.label,
    f.topic_type,
    f.label,
    f.volume,
    f.trending
  from fresh f
  join latest l
    on l.query_id = f.query_id
    and l.topic_type = f.topic_type
    and l.label = f.label
    and l.latest_week = f.metric_week
  order by f.topic_type, f.label, f.volume desc;
$$;

-- =========================================================================
-- 6. event_radar_notable_mentions — top-N menções por engajamento
--    (repost/comentário, somado por plataforma a partir de
--    `mentions.engagement`) + impacto (`mentions.impact`), últimas 72h,
--    org inteira (todas as Queries — mesma simplificação de escopo já
--    adotada pra assuntos emergentes). Seleção de linhas individuais já
--    sincronizadas — nunca soma/conta sobre a amostra pra representar um
--    total (mesmo uso já sancionado por `full_text_enrichment`).
--    ⚠️ Combina engajamento+impacto num único ranking (soma simples) —
--    inferência de MVP, não uma fórmula pesada/validada.
-- =========================================================================

create or replace function event_radar_notable_mentions(p_organization_id uuid)
returns table (
  scope_id          text,
  query_id          bigint,
  author            text,
  domain            text,
  content_source    text,
  reach_estimate    integer,
  impact            numeric,
  engagement_score  numeric,
  snippet_or_text   text,
  mention_added     timestamptz
)
language sql
stable
as $$
  with scored as (
    select
      m.resource_id,
      m.query_id,
      m.author,
      m.domain,
      m.content_source,
      m.reach_estimate,
      m.impact,
      (
        coalesce((m.engagement->>'twitterRetweets')::numeric, 0) +
        coalesce((m.engagement->>'twitterReplyCount')::numeric, 0) +
        coalesce((m.engagement->>'facebookShares')::numeric, 0) +
        coalesce((m.engagement->>'facebookComments')::numeric, 0) +
        coalesce((m.engagement->>'tiktokShares')::numeric, 0) +
        coalesce((m.engagement->>'tiktokComments')::numeric, 0) +
        coalesce((m.engagement->>'blueskyReposts')::numeric, 0) +
        coalesce((m.engagement->>'blueskyReplies')::numeric, 0) +
        coalesce((m.engagement->>'linkedinShares')::numeric, 0) +
        coalesce((m.engagement->>'linkedinComments')::numeric, 0) +
        coalesce((m.engagement->>'instagramCommentCount')::numeric, 0)
      ) as engagement_score,
      left(coalesce(m.full_text, m.snippet), 500) as snippet_or_text,
      m.added
    from mentions m
    join bw_queries q on q.id = m.query_id
    join bw_projects bp on bp.id = q.project_id
    where bp.organization_id = p_organization_id
      -- mentions é particionada por mês (mention_date) — filtro explícito
      -- garante poda de partição real, mesma disciplina de bw-sync (ver
      -- comentário equivalente em event_radar_reach_engagement_severity).
      and m.mention_date >= current_date - 3
      and m.added >= now() - interval '72 hours'
  )
  select
    resource_id, query_id, author, domain, content_source, reach_estimate,
    impact, engagement_score, snippet_or_text, added
  from scored
  where engagement_score > 0 or coalesce(impact, 0) > 0
  order by (engagement_score + coalesce(impact, 0)) desc
  limit (select notable_mentions_limit from event_radar_config());
$$;

-- =========================================================================
-- 7. run_event_detection() — corpo idêntico ao de 20260809150000, mais 2
--    blocos novos (emerging_topic/notable_mention, window '72h') logo
--    antes do bloco de dedup/fechamento (1.2) — precisam ser gravados
--    antes daquele UPDATE fechar quem não foi tocado neste ciclo.
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
  -- percentual — delta_pct fica null aqui.
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
  -- todos os escopos, incl. platform.
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
  -- todos os escopos.
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
  -- todos os escopos.
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
  -- apenas.
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
  -- anteriores, só escopo narrative.
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

  -- ✅ Novo (2026-07-16) — Assunto emergente: bw_query_topics já
  -- sincronizado, category_id is null (assunto da Query inteira, inclui
  -- fora de qualquer Narrativa), synced_at dentro das últimas 72h.
  -- metric_value = trending (crescimento já calculado pela Brandwatch);
  -- comparison_value = o limiar configurado (mesmo padrão de
  -- momentum_spike — não há "valor anterior" natural aqui, o "trending" já
  -- É o delta).
  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, detected_at
  )
  select
    o.id, 'topic', t.scope_id, 'emerging_topic', '72h',
    t.trending, v_config.topic_trending_threshold, v_cycle_start
  from organizations o
  cross join lateral event_radar_emerging_topics(o.id) t
  where t.volume >= v_config.min_volume
    and t.trending >= v_config.topic_trending_threshold
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    detected_at = excluded.detected_at;

  -- ✅ Novo (2026-07-16) — Menção de destaque: top-N mentions por
  -- engajamento (repost/comentário)+impacto das últimas 72h, organização
  -- inteira. metric_value = engagement_score + impact combinados (mesmo
  -- ranking usado pra seleção); comparison_value = 0 (baseline — qualquer
  -- engajamento acima de zero já qualifica pra estar no top-N, não há um
  -- "valor anterior" natural pra uma menção individual).
  insert into radar_staging_events (
    organization_id, scope_type, scope_id, event_type, "window",
    metric_value, comparison_value, detected_at
  )
  select
    o.id, 'mention', nm.scope_id, 'notable_mention', '72h',
    nm.engagement_score + coalesce(nm.impact, 0), 0, v_cycle_start
  from organizations o
  cross join lateral event_radar_notable_mentions(o.id) nm
  on conflict (organization_id, scope_type, scope_id, event_type, "window") where closed_at is null
  do update set
    metric_value = excluded.metric_value,
    comparison_value = excluded.comparison_value,
    detected_at = excluded.detected_at;

  -- 1.2 deduplication-grouping — "quando o indicador volta ao normal":
  -- toda regra acima é reavaliada por completo a cada ciclo — se uma linha
  -- ativa não foi atualizada neste ciclo, a regra que a originou deixou de
  -- disparar (inclui: um assunto que deixou de ser "emergente", ou uma
  -- menção que saiu do top-N de engajamento/impacto).
  update radar_staging_events
  set closed_at = v_cycle_start
  where closed_at is null
    and detected_at < v_cycle_start;

  update feed_events fe
  set closed_at = v_cycle_start
  from radar_staging_events e4
  where fe.radar_staging_event_id = e4.id
    and e4.closed_at = v_cycle_start
    and fe.closed_at is null;

  -- 1.3 severity — score contínuo 0-100 sobre os eventos ativos.
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
  -- organização.
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
-- 8. event_radar_build_agent_payload() — corpo idêntico ao de
--    20260731020000, mais 2 branches novos ('topic'/'mention') e 2 chaves
--    novas no jsonb final ('topic_detail'/'mention_detail', sempre
--    presentes, `null` quando não se aplicam).
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
  v_topic_detail jsonb;
  v_mention_detail jsonb;
  v_sep_pos integer;
  v_topic_type text;
  v_label text;
begin
  select * into v_event from radar_staging_events where id = p_event_id;
  if not found then
    return null;
  end if;

  v_topic_detail := null;
  v_mention_detail := null;

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

  elsif v_event.scope_type = 'topic' then
    -- Assunto emergente: scope_id = 'topic_type:label'.
    v_sep_pos := position(':' in v_event.scope_id);
    v_topic_type := left(v_event.scope_id, v_sep_pos - 1);
    v_label := substring(v_event.scope_id from v_sep_pos + 1);
    v_scope_label := v_label;
    v_topics := '[]'::jsonb;
    v_platforms := '[]'::jsonb;
    v_authors := '[]'::jsonb;
    v_author_count := 0;

    select jsonb_build_object(
        'topic_type', t.topic_type, 'label', t.label,
        'volume', t.volume, 'trending', t.trending,
        'percentage_volume', t.percentage_volume
      )
      into v_topic_detail
    from bw_query_topics t
    join bw_queries q on q.id = t.query_id
    join bw_projects bp on bp.id = q.project_id
    where bp.organization_id = v_event.organization_id
      and t.category_id is null
      and t.topic_type = v_topic_type
      and t.label = v_label
    order by t.metric_week desc
    limit 1;

  elsif v_event.scope_type = 'mention' then
    -- Menção de destaque: scope_id = mentions.resource_id.
    v_topics := '[]'::jsonb;
    v_platforms := '[]'::jsonb;
    v_authors := '[]'::jsonb;
    v_author_count := 0;

    select jsonb_build_object(
        'author', m.author, 'domain', m.domain, 'content_source', m.content_source,
        'reach_estimate', m.reach_estimate, 'impact', m.impact,
        'text', left(coalesce(m.full_text, m.snippet), 500),
        'added', m.added
      ),
      'Menção de ' || coalesce(m.author, 'autor desconhecido')
      into v_mention_detail, v_scope_label
    from mentions m
    join bw_queries q on q.id = m.query_id
    join bw_projects bp on bp.id = q.project_id
    where bp.organization_id = v_event.organization_id
      and m.resource_id = v_event.scope_id
      and m.mention_date >= current_date - 3
    order by m.added desc
    limit 1;

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
    'topic_detail', v_topic_detail,
    'mention_detail', v_mention_detail,
    'sibling_events', v_sibling_events,
    'recent_related_cards', v_recent_related_cards
  );
end;
$$;
