-- Módulo `foundation`/`narratives` — "Resumo executivo" ganha finalmente um
-- produtor. `narratives.description` (= `summary` no bloco `narratives` do
-- envelope, `get_narratives_table`) era um campo reservado desde
-- `20260707000000` sem nenhum caminho de escrita em lugar nenhum do
-- projeto — `NarrativeCard`/`narrative-detail-content.tsx` sempre
-- renderizavam o fallback "Resumo automático ainda não disponível para
-- esta Narrativa." (achado real desta sessão, 2026-07-14, a partir de
-- screenshot do usuário mostrando o fallback em toda Narrativa da tela).
-- `foundation/narratives.md`/`intelligence-center/narratives-exploration.md`
-- já apontavam o candidato natural: reaproveitar o padrão de composição via
-- IA já usado por `ai-synthesis.md` (Camada 1) + os `highlights` do
-- `event-radar`, sem nunca ter sido de fato construído.
--
-- Diferente de `page_narrative_synthesis` (ai-synthesis Camada 1 — síntese
-- por PÁGINA/período, invalidada por período), este é um resumo por
-- NARRATIVA, sem janela de período — por isso não reaproveita aquela
-- tabela, e por isso precisa de um agendamento próprio (pg_cron) em vez do
-- padrão "compõe em background na leitura da página" já usado pela Camada
-- 1 (gerar uma vez por narrativa a cada carregamento de página, sem
-- nenhuma limitação de orçamento entre invocações concorrentes, seria caro
-- demais — mesma preocupação de custo já registrada em todo o módulo
-- `event-radar`).

-- =========================================================================
-- 1. narratives.description_generated_at — quando o resumo atual foi
--    gerado. Não reaproveita `updated_at` (que já existe via trigger
--    set_updated_at) de propósito: `updated_at` muda em qualquer UPDATE
--    futuro de qualquer coluna desta tabela, não só do resumo — uma coluna
--    própria mantém o sinal de staleness deste job específico correto
--    mesmo que outra escrita em `narratives` apareça no futuro.
-- =========================================================================

alter table narratives
  add column if not exists description_generated_at timestamptz;

comment on column narratives.description_generated_at is
  'Quando narratives.description foi gerado pela última vez pelo job narrative-summary-composer (pg_cron, ver 20260804010000). null = nunca gerado. Não é updated_at (esse muda em qualquer escrita futura na linha, não só nesta) — narrative_summary_due_ids() usa esta coluna pra decidir se o resumo está desatualizado.';

-- =========================================================================
-- 2. narrative_summary_due_ids — quais Narrativas precisam de um resumo
--    novo/atualizado, priorizadas e limitadas por invocação (mesmo padrão
--    de orçamento por invocação já usado por bw-sync/event-radar-agent-
--    orchestrator). Uma Narrativa é "devida" quando:
--    a) nunca teve resumo gerado; ou
--    b) o último resumo já passou de 7 dias (refresh periódico — scores
--       como sentimento/momentum/risco derivam continuamente, não só de
--       eventos discretos); ou
--    c) surgiu um feed_events (evento do radar) novo pra ela desde o
--       último resumo; ou
--    d) surgiu uma Comunicação/Decisão nova (módulo communications) desde
--       o último resumo.
--    Só Narrativas com Category/Subcategory ainda ativa na Brandwatch
--    (bc.status = 'active', mesmo filtro de get_narratives_table) — uma
--    Narrativa inativa não aparece em nenhuma tela, gerar resumo pra ela
--    seria gasto de chamada de IA sem consumidor.
-- =========================================================================

create or replace function narrative_summary_due_ids(p_batch_size integer default 5)
returns table (narrative_id uuid)
language sql
stable
set search_path = public
as $$
  select n.id
  from narratives n
  join bw_categories bc on bc.id = n.bw_category_id
  where bc.status = 'active'
    and (
      n.description_generated_at is null
      or n.description_generated_at < now() - interval '7 days'
      or exists (
        select 1 from feed_events fe
        where fe.related_narrative_id = n.id
          and fe.created_at > n.description_generated_at
      )
      or exists (
        select 1 from communications c
        where c.narrative_id = n.id
          and c.created_at > n.description_generated_at
      )
    )
  order by (n.description_generated_at is null) desc, n.description_generated_at asc nulls first
  limit p_batch_size
$$;

comment on function narrative_summary_due_ids(integer) is
  'Narrativas cujo narratives.description precisa ser (re)gerado pelo job narrative-summary-composer, priorizadas por nunca-geradas primeiro, depois mais antigas. Ver comentário de topo da migration 20260804010000 pras 4 condições de staleness.';

-- =========================================================================
-- 3. narrative_summary_build_payload — payload agregado enviado à IA, nunca
--    texto bruto de mentions (mesmo princípio de
--    event_radar_build_agent_payload/agent-orchestrator.md): scores já
--    calculados via get_narratives_table (mesma fonte que a tabela/cards já
--    mostram — o resumo tem que concordar com os números ao lado dele, não
--    descrever um cálculo próprio divergente), eventos recentes do radar
--    (feed_events) e Comunicações/Decisões recentes (communications) da
--    mesma Narrativa.
-- =========================================================================

create or replace function narrative_summary_build_payload(p_narrative_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'title', n.title,
    'category_label', coalesce(parent_bc.name, bc.name),
    'scores', (
      select jsonb_build_object(
        'sov_pct', g.sov_pct,
        'total_mentions', g.total_mentions,
        'net_sentiment', g.net_sentiment,
        'sentiment_label', g.sentiment_label,
        'sentiment_positive_pct', g.sentiment_positive_pct,
        'sentiment_neutral_pct', g.sentiment_neutral_pct,
        'sentiment_negative_pct', g.sentiment_negative_pct,
        'momentum_score', g.momentum_score,
        'trend_score', g.trend_score,
        'trend_label', g.trend_label,
        'risk_score', g.risk_score,
        'risk_label', g.risk_label,
        'tags', g.tags
      )
      from get_narratives_table(
        n.organization_id,
        current_date - 29,
        current_date,
        jsonb_build_object('narratives', jsonb_build_array(n.id)),
        null,
        null,
        now()
      ) g
      limit 1
    ),
    'recent_events', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'title', fe.title,
          'summary', fe.summary,
          'event_type', fe.event_type,
          'severity', fe.severity,
          'created_at', fe.created_at,
          'closed_at', fe.closed_at
        ) order by fe.created_at desc), '[]'::jsonb)
      from (
        select title, summary, event_type, severity, created_at, closed_at
        from feed_events
        where related_narrative_id = n.id
        order by created_at desc
        limit 5
      ) fe
    ),
    'recent_communications', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'title', c.title,
          'record_type', c.record_type,
          'occurred_at', c.occurred_at,
          'channel_detail', c.channel_detail
        ) order by c.occurred_at desc), '[]'::jsonb)
      from (
        select title, record_type, occurred_at, channel_detail
        from communications
        where narrative_id = n.id
        order by occurred_at desc
        limit 5
      ) c
    )
  )
  from narratives n
  join bw_categories bc on bc.id = n.bw_category_id
  left join bw_categories parent_bc on parent_bc.id = bc.parent_id
  where n.id = p_narrative_id
$$;

comment on function narrative_summary_build_payload(uuid) is
  'Payload agregado (nunca texto bruto de mentions) enviado à IA pelo job narrative-summary-composer para compor narratives.description: scores via get_narratives_table (últimos 30 dias, mesma fonte da tabela/cards), até 5 eventos recentes do event-radar (feed_events) e até 5 Comunicações/Decisões recentes (communications) da mesma Narrativa. null se a Narrativa não existir.';

-- =========================================================================
-- 4. Agendamento — pg_cron a cada 30min (menos urgente que o heartbeat de
--    15min de bw-sync/event-radar: um resumo executivo é uma foto do estado
--    atual da Narrativa, não uma detecção de evento em tempo real — 30min
--    já é folgado o suficiente frente à janela de refresh periódico de 7
--    dias). URL hardcoded — mesmo projeto Supabase único de sempre, não é
--    segredo (Princípio técnico 1 é sobre credenciais, ver
--    bw-sync-heartbeat/event-radar-agent-orchestrator-heartbeat acima).
-- =========================================================================

select cron.schedule(
  'narrative-summary-composer-heartbeat',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://ktvyqpogfnowuqmjybvu.supabase.co/functions/v1/narrative-summary-composer',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
