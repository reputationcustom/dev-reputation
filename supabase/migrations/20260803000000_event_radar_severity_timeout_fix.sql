-- event-radar — bug real de produção encontrado via log do Supabase
-- (usuário colou o erro): `run_event_detection()` estava falhando em TODO
-- ciclo do pg_cron (15min) com "ERROR: canceling statement due to
-- statement timeout" dentro de `event_radar_reach_engagement_severity`
-- (escopo 'platform'), na query que calcula `v_max`:
--
--   select max(pd.engagement_score)
--   from bw_query_metrics_daily_by_platform pd
--   ...
--   where pd.metric_date = (
--     select max(metric_date) from bw_query_metrics_daily_by_platform pd2
--     where pd2.query_id = pd.query_id and pd2.page_type = pd.page_type
--       and pd2.category_id is null
--   )
--
-- Causa raiz: o único índice que cobre esta tabela é o `unique
-- (project_id, query_id, category_id_key, page_type, metric_date)`
-- (20260711090000) — lidera por `project_id`, mas a subquery correlacionada
-- filtra só por `query_id`/`page_type`/`category_id is null`, sem
-- `project_id`. Sem um índice cuja coluna líder seja `query_id`, o Postgres
-- não consegue um index seek eficiente para essa subquery, que roda uma
-- vez por linha candidata — e como esta tabela "acumula indefinidamente"
-- por design (CLAUDE.md, "Data storage is historical by design", sem job
-- de retenção/poda), o custo só cresce com o tempo até estourar o
-- `statement_timeout`. `bw_query_metrics_daily` tem exatamente o mesmo
-- problema estrutural para o escopo 'query' (`unique (project_id,
-- query_id, category_id, metric_date)`, também líder por `project_id`) —
-- ainda não visto no log, mas mesma causa, corrigido preventivamente aqui.
-- `narrative_metrics` não tem este problema: seu `unique (narrative_id,
-- metric_date, period)` já lidera por `narrative_id`, exatamente a coluna
-- usada pela subquery correlacionada do escopo 'narrative'.
--
-- Efeito prático do bug: `run_event_detection()` é uma única função
-- `language plpgsql`, sem nenhum bloco `EXCEPTION` em lugar nenhum — o
-- pg_cron chama `select run_event_detection()` como uma única transação
-- implícita. Um erro não capturado em QUALQUER statement (aqui, a
-- atualização de severidade da 1.3, que roda por último) aborta a
-- invocação inteira e desfaz TUDO que essa mesma chamada já tinha feito
-- antes — incluindo os INSERTs de detecção (1.1) e o fechamento por
-- dedup (1.2) que rodam mais cedo na mesma função. Por isso, de fora,
-- parecia que "a cron não está iniciando o processo": na real o pg_cron
-- está invocando a função a cada 15min corretamente, só que toda
-- invocação falha no mesmo ponto e sofre rollback total, então nunca
-- nenhuma linha nova chega a ficar de pé em `radar_staging_events`.
--
-- Duas correções, uma resolve a causa raiz e a outra evita que uma falha
-- futura (nesta ou em qualquer outra sub-etapa) volte a derrubar o ciclo
-- inteiro:

-- 1) Índices parciais cobrindo exatamente o padrão de filtro usado pelas
--    subqueries correlacionadas de `event_radar_reach_engagement_severity`
--    (e por qualquer outro consumidor futuro do mesmo padrão "linha da
--    Query/Plataforma inteira, dia mais recente"). `desc` na última coluna
--    permite que `max(metric_date)` seja resolvido por um index scan que
--    já devolve a primeira linha, sem agregação de fato.
create index if not exists bw_query_metrics_daily_query_date_idx
  on bw_query_metrics_daily (query_id, metric_date desc)
  where category_id is null;

create index if not exists bw_query_metrics_daily_by_platform_query_page_date_idx
  on bw_query_metrics_daily_by_platform (query_id, page_type, metric_date desc)
  where category_id is null;

-- 2) `run_event_detection()` — mesmo corpo de `20260802000000`, só a etapa
--    1.3 (severity) + seu espelhamento em `feed_events` passam a rodar
--    dentro de um bloco `begin...exception when others`, que cria um
--    savepoint implícito: se essa sub-etapa falhar por qualquer motivo
--    (uma query lenta, uma função de severidade quebrando em algum caso
--    de borda), o erro é capturado e logado via `RAISE WARNING` (visível
--    em Supabase Dashboard → Database → Logs/pg_cron), e a função segue
--    para a 1.6 (volume-limits, que já tolera `severity_score` nulo/stale
--    via `order by ... desc nulls last`) em vez de abortar e desfazer a
--    1.1/1.2 que já tinham rodado com sucesso neste mesmo ciclo. Nenhuma
--    mudança de assinatura/schema.
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
  --
  -- Envolvida num bloco begin/exception (savepoint implícito): uma falha
  -- aqui (ex: uma query lenta estourando statement_timeout, exatamente o
  -- bug de produção que esta migration corrige na raiz via os 2 índices
  -- acima) não pode mais desfazer a 1.1/1.2 já commitadas nesta mesma
  -- invocação — só pula a atualização de severidade deste ciclo, loga um
  -- aviso, e segue pra 1.6.
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

    -- Espelha severity_score/severity no feed_events vinculado, enquanto o
    -- evento continua ativo (ajuste encontrado ao revisar fluxo-aggregated-metrics.md
    -- antes da Fase B/aggregated-metrics: A2, "risk_score = greatest(risk_score
    -- calculado, severity_score do evento ativo)", precisa ler um
    -- severity_score sempre atual em feed_events).
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
  -- contrário — 1.4 ainda não existe, mas seu próprio spec já assume
  -- "dentro do cap diário" como pré-condição, ver agent-orchestrator.md).
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
