-- event-radar 1.1 — nova regra de detecção por Momentum.
--
-- Achado do usuário: "No cálculo realizado pelo RADAR para criar os
-- eventos não me parece que está sendo considerado o momentum... existem
-- algumas narrativas que tem o momento explosivo e que não gerou nenhum
-- evento no radar." Confirmado por leitura de código, não impressão:
-- `run_event_detection()` (1.1) só dispara a partir de volume bruto e
-- sentimento (`event_radar_hourly_series`/`event_radar_daily_series`,
-- fontes `bw_query_metrics_hourly`/`daily`/`narrative_metrics`) — nunca lê
-- `momentum_score` nem os 4 fatores que o compõem (crescimento de volume/
-- engajamento/autores/alcance, `aggregated-metrics/sql-aggregation.md`,
-- "Momentum"). A etapa 1.3 (severidade) só toca Momentum indiretamente
-- (fator "Risco da narrativa relacionada", 10% do peso, via `risk_score` —
-- que já embute Momentum a 25%) e só depois que um evento já existe. Ou
-- seja: uma Narrativa podia ter Momentum "Explosivo" (crescimento forte de
-- engajamento/autores/alcance) sem cruzar os limiares de volume bruto da
-- 1.1, e nesse caso nenhum evento era gerado — exatamente o sintoma
-- relatado.
--
-- ⚠️ Esclarecimento de nomenclatura, respondendo à segunda pergunta do
-- usuário ("substituímos velocidade por momentum, verifique se isso está
-- correto"): não foi isso que aconteceu. Em 2026-07-22
-- (`20260722010000_velocity_to_statistical_trend.sql`) "Velocidade" (score
-- de Narrativa, snapshot 3h-vs-3h) foi substituída por "Tendência"
-- (`trend_score`, regressão de 14 dias) — Momentum nunca foi tocado, é um
-- quarto score, sempre existiu separado (pedido explícito do usuário na
-- época: "os indicadores se mantém como risk_score e momentum"). Este
-- gap real (Momentum nunca alimentar detecção) é uma decisão distinta,
-- tomada e documentada em `_pending.md` gap #32 (2026-07-24): "o indicador
-- momentum_score já representa esse sinal bem o suficiente, sem precisar
-- de uma regra de detecção própria em event-radar." Esta migration reverte
-- essa decisão, a pedido do usuário nesta sessão (opção escolhida via
-- AskUserQuestion: "Nova regra de detecção por Momentum").
--
-- Desenho: só escopo `narrative` (Momentum, como score de produto, só
-- existe pra Narrativa — não há "Momentum de Query" ou "Momentum de
-- plataforma" em nenhum lugar do produto, ver `get_narratives_table`).
-- Reaproveita a MESMA fórmula/pesos já em produção
-- (`aggregated-metrics/sql-aggregation.md`, "Momentum": 0.40 volume +
-- 0.25 engajamento + 0.20 autores + 0.15 alcance, via `norm_growth` —
-- função já existente desde `20260714000000`, chamada aqui sem
-- redefinição) — não uma segunda fórmula divergente. Janela: reaproveita
-- "3d" (já existe no CHECK constraint de `radar_staging_events."window"`,
-- já usada por volume_spike/volume_drop "Últimos 3 dias") em vez de criar
-- uma janela nova — mesma escolha pragmática de MVP já documentada pra
-- todo outro threshold deste módulo (revisar se 3 dias provar ruidoso
-- demais pra um índice composto; o período "oficial" de Momentum na UI é
-- o selecionado no header, sem equivalente fixo aqui por desenho).
-- Threshold: reaproveita a própria faixa "Explosivo" (>=80) já definida em
-- sql-aggregation.md — não um número novo inventado pra este módulo.
--
-- ⚠️ Guarda anti-falso-positivo, não presente na fórmula original: no
-- `momentum` CTE de `get_narratives_table`, um `left join period_agg`
-- sobre `latest_day` já garante implicitamente que só Narrativas com dado
-- no período selecionado aparecem. Aqui não há equivalente — toda
-- Narrativa ativa da organização é avaliada, então sem uma guarda
-- explícita, `norm_growth(null, valor_real)` (dado do período atual ainda
-- não sincronizado, período anterior com atividade real) resolve pra 100
-- (LEAST/GREATEST do Postgres ignoram NULL em vez de propagar) — um
-- "crescimento explosivo" inteiramente artefato de atraso de sync, não
-- growth real. `event_radar_narrative_momentum()` abaixo exige
-- `vol_current is not null` (a coluna mais confiável — total_mentions é
-- sempre populada primeiro e incondicionalmente por `daily_metrics`, ver
-- CLAUDE.md) antes de considerar a Narrativa candidata. Os outros 3
-- fatores (engajamento/autores/alcance) ainda podem sofrer o mesmo
-- artefato individualmente sem travar a Narrativa inteira — mesmo risco
-- latente que já existe hoje na fórmula de produção, não introduzido por
-- esta migration, só não coberto pela guarda (documentado, não
-- silenciado).

-- =========================================================================
-- 1. event_radar_config() ganha momentum_spike_threshold — precisa de DROP
--    explícito (adicionar coluna à saída de uma function RETURNS TABLE não
--    é possível via CREATE OR REPLACE puro, mesma lição já paga em
--    20260730000000/get_narratives_table).
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
  momentum_spike_threshold   numeric
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
    3,      -- z-score mínimo — "relevante"
    15,     -- cap diário de eventos "enfileirados pra IA" por organização
    80      -- momentum_score mínimo pra momentum_spike — mesma faixa
            -- "Explosivo" já definida em aggregated-metrics/sql-aggregation.md,
            -- não um número novo
$$;

-- =========================================================================
-- 2. event_radar_narrative_momentum — mesma fórmula/pesos de Momentum já
--    em produção (aggregated-metrics/sql-aggregation.md), aplicada a uma
--    janela fixa de 3 dias (em vez do período selecionado na UI, que este
--    motor periódico não tem). Só narrative_metrics (fonte oficial,
--    não-amostrada) — nunca soma local sobre mentions.
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
        where nm.metric_date between current_date - 2 and current_date
      ) as vol_current,
      sum(nm.total_mentions) filter (
        where nm.metric_date between current_date - 5 and current_date - 3
      ) as vol_previous,
      sum(nm.engagement_total) filter (
        where nm.metric_date between current_date - 2 and current_date
      ) as engagement_current,
      sum(nm.engagement_total) filter (
        where nm.metric_date between current_date - 5 and current_date - 3
      ) as engagement_previous,
      avg(nm.unique_authors) filter (
        where nm.metric_date between current_date - 2 and current_date
      ) as authors_current,
      avg(nm.unique_authors) filter (
        where nm.metric_date between current_date - 5 and current_date - 3
      ) as authors_previous,
      sum(nm.reach_estimated) filter (
        where nm.metric_date between current_date - 2 and current_date
      ) as reach_current,
      sum(nm.reach_estimated) filter (
        where nm.metric_date between current_date - 5 and current_date - 3
      ) as reach_previous
    from scope s
    left join narrative_metrics nm
      on nm.narrative_id = s.narrative_id
      and nm.period = 'daily'
      and nm.source = 'bw_aggregate'
      and nm.metric_date between current_date - 5 and current_date
    group by s.narrative_id
  )
  select
    narrative_id::text,
    round(
      0.40 * norm_growth(vol_current, vol_previous) +
      0.25 * norm_growth(engagement_current, engagement_previous) +
      0.20 * norm_growth(authors_current, authors_previous) +
      0.15 * norm_growth(reach_current, reach_previous)
    )
  from period_agg
  -- guarda anti-falso-positivo, ver nota no topo do arquivo.
  where vol_current is not null
$$;

-- =========================================================================
-- 3. run_event_detection() — CREATE OR REPLACE, corpo idêntico ao de
--    20260803000000 (1.1 + 1.2 + 1.3 + espelhamento em feed_events + 1.6),
--    mais o bloco de detecção por Momentum (1.1) inserido logo após a
--    última regra de z-score, antes do fechamento por dedup (1.2) — assim
--    o mesmo mecanismo de "não foi tocado neste ciclo -> fecha" (1.2) já
--    encerra um momentum_spike automaticamente quando o Momentum volta a
--    cair abaixo do limiar, sem código extra.
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

  -- Momentum "Explosivo" (novo, esta migration) — Últimos 3 dias vs. 3 dias
  -- anteriores, só escopo narrative. Reaproveita a janela "3d" já existente
  -- no CHECK constraint. metric_value = momentum_score calculado;
  -- comparison_value = o próprio limiar configurado (não há "valor anterior"
  -- de comparação natural aqui, diferente das regras de volume — a "linha
  -- de base" É o limiar). delta_pct/z_score ficam null (não se aplicam a
  -- este tipo de regra).
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
