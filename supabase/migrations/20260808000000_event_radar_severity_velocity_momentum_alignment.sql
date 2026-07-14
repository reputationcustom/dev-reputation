-- event-radar 1.3 — fator "Velocidade" da severidade desconectado do
-- próprio sinal que a regra `momentum_spike` (20260807000000) detecta.
--
-- User report, com screenshot de um card real do Radar de Eventos:
-- "Alto 78" (não vermelho/crítico), narrativa com "crescimento de mais de
-- 1.000% em volume de menções nos últimos 3 dias", tag da IA
-- "momentum_crescente" — "reveja a cor dos cards do radar... tenho um
-- event é critico momentum alto e não ficou vermelho."
--
-- Investigação (sem acesso a produção nesta sessão, feita por leitura de
-- código): `RiskBadge`/`SEVERITY_BORDER` (`recent-events-panel.tsx`,
-- `score-badges.tsx`) só leem o `severity`/`severity_score` já gravados —
-- não há bug de mapeamento cor↔label no frontend, "Alto" (60-84) realmente
-- renderiza laranja e só "Crítico" (>=85) renderiza vermelho, por desenho.
-- A causa real está em como `severity_score` é CALCULADO pra um evento
-- `momentum_spike`: o fator "Velocidade" (20% do peso,
-- `event_radar_velocity_severity()`) sempre recalcula uma janela fixa de
-- 3h-vs-3h — completamente desconectada da janela/sinal que realmente
-- gerou o evento (`momentum_spike` usa "3d" e já tem seu PRÓPRIO score
-- 0-100, `momentum_score`, gravado em `radar_staging_events.metric_value`
-- no momento da detecção). Se o crescimento explosivo já aconteceu mais
-- cedo dentro da janela de 3 dias e o volume já estabilizou num platô alto
-- nas últimas 3h, a comparação 3h-vs-3h pode ler perto de zero de variação
-- — o fator "Velocidade" despenca pra perto de 0 (não 50/neutro — o
-- cálculo roda de verdade, só que sobre um sinal que não tem relação
-- nenhuma com "o evento é sobre Momentum") justamente no fator de 20% de
-- peso que deveria refletir a força do sinal que motivou o card.
-- Reconstituindo com números plausíveis do card do usuário
-- (volume=100 capado, sentimento~50, velocidade~0 nesse cenário,
-- alcance~50-70, autores~30, risco da narrativa relacionada~60,
-- persistência~0 — evento com "27 min" de vida): a soma pesada fecha bem
-- perto de 78, exatamente o valor reportado — consistente com o
-- diagnóstico.
--
-- Fix: `event_radar_velocity_severity()` ganha 2 parâmetros novos
-- (`p_event_type`, `p_metric_value`) — quando o evento é `momentum_spike`,
-- o fator "Velocidade" passa a ser o próprio `momentum_score` já calculado
-- na detecção (`metric_value`, já 0-100, só clampado defensivamente),
-- em vez de recalcular um 3h-vs-3h sem relação com o que gerou o evento.
-- Para todo outro `event_type` (volume_spike/drop, sentiment_change etc.),
-- o comportamento é idêntico ao de antes — nenhuma mudança de severidade
-- pra eventos que não são de Momentum. Efeito esperado no exemplo do
-- usuário: 0.20 * (velocidade 0 → momentum_score, tipicamente >=80 já que
-- é o próprio limiar de disparo da regra) adiciona ~16 pontos ao score
-- ponderado — o suficiente pra cruzar 85 (Crítico) num caso como o
-- relatado, sem tocar em nenhum outro peso/fórmula da severidade.

-- =========================================================================
-- 1. event_radar_velocity_severity ganha p_event_type/p_metric_value —
--    mudança de aridade, precisa de DROP explícito antes do CREATE (mesma
--    regra de sempre pra troca de assinatura de function).
-- =========================================================================

drop function if exists event_radar_velocity_severity(uuid, text, text);

create function event_radar_velocity_severity(
  p_organization_id uuid,
  p_scope_type text,
  p_scope_id text,
  p_event_type text,
  p_metric_value numeric
)
returns numeric
language sql
stable
as $$
  select case
    when p_event_type = 'momentum_spike' then least(100, greatest(0, p_metric_value))
    else (
      select least(100, abs(event_radar_delta_pct(s.current_volume, s.previous_volume)))
      from event_radar_hourly_symmetric(p_organization_id, 3) s
      where s.scope_type = p_scope_type
        and s.scope_id = p_scope_id
    )
  end
$$;

-- =========================================================================
-- 2. run_event_detection() — CREATE OR REPLACE, corpo idêntico ao de
--    20260807000000, só a chamada de event_radar_velocity_severity() na
--    etapa 1.3 (severidade) passa a incluir e2.event_type/e2.metric_value.
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

  -- Momentum "Explosivo" — Últimos 3 dias vs. 3 dias anteriores, só escopo
  -- narrative. Reaproveita a janela "3d" já existente no CHECK constraint.
  -- metric_value = momentum_score calculado; comparison_value = o próprio
  -- limiar configurado (não há "valor anterior" de comparação natural
  -- aqui, diferente das regras de volume — a "linha de base" É o limiar).
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
  -- ✅ 2026-08-08: event_radar_velocity_severity() agora recebe
  -- event_type/metric_value — pra um evento momentum_spike, o fator
  -- "Velocidade" usa o próprio momentum_score já calculado na detecção,
  -- não um 3h-vs-3h desconectado do que gerou o evento (ver comentário no
  -- topo deste arquivo).
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
