-- Pendência de foundation #2 (.dev/specs/_pending.md, "Gaps técnicos" —
-- especificada em foundation/data-model.md ("bw_query_metrics_hourly") e
-- passo 6.3e de foundation/sync-brandwatch.md): volume/sentimento em grão
-- horário, janela móvel de 30 dias buscada a cada invocação (não é
-- histórico/BI como bw_query_metrics_daily — só detecção intra-dia do
-- event-radar e Velocidade de aggregated-metrics). Estrutura e decisões
-- (colunas, sem job de retenção/limpeza — mesma filosofia de "histórico
-- acumula indefinidamente por design" já aplicada a daily/weekly/monthly,
-- volume de linhas continua trivial pro Postgres) já fechadas em
-- data-model.md — esta migration só materializa o schema já especificado.

create table if not exists bw_query_metrics_hourly (
  id                    uuid primary key default gen_random_uuid(),
  project_id            bigint not null references bw_projects(id) on delete cascade,
  query_id              bigint not null references bw_queries(id) on delete cascade,
  category_id           bigint references bw_categories(id) on delete cascade,
  category_id_key       bigint generated always as (coalesce(category_id, 0)) stored,
  metric_hour           timestamptz not null,
  total_mentions        integer not null default 0,
  sentiment_positive    integer not null default 0,
  sentiment_neutral     integer not null default 0,
  sentiment_negative    integer not null default 0,
  net_sentiment         numeric,
  synced_at             timestamptz not null default now(),
  unique (project_id, query_id, category_id_key, metric_hour)
);

alter table bw_query_metrics_hourly enable row level security;

create policy "org_isolation_bw_query_metrics_hourly_select"
  on bw_query_metrics_hourly for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );

-- Nova fase `hourly_metrics` em SYNC_STEPS (bw-sync/index.ts) — atualiza a
-- mesma constraint corrigida em 20260712010000 depois de esquecida uma vez
-- (bug de produção real: "new row for relation sync_cursors violates check
-- constraint"). Posicionada logo após `daily_metrics`, mesmo agrupamento
-- lógico (métricas por Query/Narrativa que rodam toda invocação).
alter table sync_cursors drop constraint if exists sync_cursors_next_step_check;
alter table sync_cursors
  add constraint sync_cursors_next_step_check
  check (next_step in (
    'metadata', 'mentions', 'daily_metrics', 'hourly_metrics', 'weekly_monthly', 'topics',
    'platform_by_narrative', 'x_insights', 'top_authors', 'top_tweeters',
    'author_enrichment', 'top_sites', 'top_shared_sites', 'demographics', 'sov'
  ));
