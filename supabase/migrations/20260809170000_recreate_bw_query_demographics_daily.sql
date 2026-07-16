-- Recria bw_query_demographics_daily depois de um DROP TABLE acidental em
-- produção (2026-07-16). Reproduz o schema exatamente como estava em
-- produção antes do drop, reunindo as 2 migrations que já tinham tocado
-- esta tabela:
--   - 20260711070000: criação original (colunas base, trigger, RLS, policy).
--   - 20260712020000: adição da coluna `net_sentiment`.
-- Nenhuma outra migration altera esta tabela — 20260725010000/20260725060000
-- só recriam a function get_region_breakdown (leitora), sem DDL sobre a
-- tabela em si. `create table if not exists` mantém o mesmo padrão
-- idempotente do arquivo original.

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
  net_sentiment  numeric,
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
