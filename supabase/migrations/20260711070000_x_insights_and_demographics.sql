-- Implementa bw_query_x_insights e bw_query_demographics_daily — ambas já
-- especificadas em revisão de spec anterior no mesmo dia (2026-07-11), mas
-- só priorizadas pra código depois de validar o modelo de dados contra um
-- export real de dashboard Brandwatch: "X Themes" (Top Stories/Hashtags/
-- Posters/Emojis) confirma exatamente o shape de bw_query_x_insights; "X
-- Demographics" (gender split + trend diário, top interests, top
-- professions, top countries) confirma exatamente o shape de
-- bw_query_demographics_daily. Ver data-model.md §5 e sync-brandwatch.md
-- passos 6.4b/6.6 pro racional completo (endpoints, premissa de sampling).

create table if not exists bw_query_x_insights (
  id                 uuid primary key default gen_random_uuid(),
  project_id         bigint not null references bw_projects(id) on delete cascade,
  query_id           bigint not null references bw_queries(id) on delete cascade,
  category_id        bigint references bw_categories(id) on delete cascade,
  category_id_key    bigint generated always as (coalesce(category_id, 0)) stored,
  insight_type       text not null check (insight_type in ('hashtag', 'emoticon', 'url', 'mentioned_author')),
  name               text not null,
  label              text,
  volume             integer not null default 0,
  tweets             integer,
  retweets           integer,
  impressions        integer,
  reach_estimate     integer,
  sentiment_positive integer not null default 0,
  sentiment_neutral  integer not null default 0,
  sentiment_negative integer not null default 0,
  metric_week        date not null,
  synced_at          timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (project_id, query_id, category_id_key, insight_type, name, metric_week)
);

create trigger set_updated_at
  before update on bw_query_x_insights
  for each row execute function set_updated_at();

alter table bw_query_x_insights enable row level security;

create policy org_isolation_bw_query_x_insights on bw_query_x_insights
  for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );

create table if not exists bw_query_demographics_daily (
  id             uuid primary key default gen_random_uuid(),
  project_id     bigint not null references bw_projects(id) on delete cascade,
  query_id       bigint not null references bw_queries(id) on delete cascade,
  dimension_type text not null check (dimension_type in (
    'gender', 'account_type', 'interest', 'profession', 'country', 'continent', 'city', 'region'
  )),
  value          text not null,
  metric_date    date not null,
  total_mentions integer not null default 0,
  synced_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (project_id, query_id, dimension_type, value, metric_date)
);

create trigger set_updated_at
  before update on bw_query_demographics_daily
  for each row execute function set_updated_at();

alter table bw_query_demographics_daily enable row level security;

create policy org_isolation_bw_query_demographics_daily on bw_query_demographics_daily
  for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );

-- Novas fases `x_insights`/`top_sites`/`demographics` na execução em fases
-- de bw-sync (migration 20260711030000/20260711040000) — ver SYNC_STEPS em
-- bw-sync/index.ts pra ordem exata.
alter table sync_cursors drop constraint if exists sync_cursors_next_step_check;
alter table sync_cursors
  add constraint sync_cursors_next_step_check
  check (next_step in (
    'metadata', 'mentions', 'daily_metrics', 'weekly_monthly', 'topics',
    'x_insights', 'top_authors', 'author_enrichment', 'top_sites',
    'demographics', 'sov'
  ));
