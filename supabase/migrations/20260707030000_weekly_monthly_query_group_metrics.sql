-- Fecha o gap de grão semanal/mensal e do SOV de Query Group (⚠️ DECISÃO
-- PENDENTE nunca resolvida em overview.md — "grão exato fica para
-- data-model.md"). Mesma lógica/RLS de bw_query_metrics_daily, só trocando
-- o grão de tempo. Ver .dev/specs/foundation/data-model.md e
-- sync-brandwatch.md (passos 6/6b) para o comportamento de sync completo.
--
-- Correção também aplicada aqui e em bw_query_metrics_daily (ver bloco
-- abaixo): `unique (..., category_id, ...)` com category_id nullable NÃO
-- deduplica corretamente — SQL trata NULL <> NULL, então toda linha "sem
-- category" (métrica da Query inteira) passaria a inserir uma linha nova a
-- cada sync em vez de fazer upsert. Corrigido com uma coluna gerada
-- `category_id_key` (coalesce(category_id, 0)) e a unique constraint nessa
-- coluna em vez de `category_id` diretamente.

create table if not exists bw_query_metrics_weekly (
  id                    uuid primary key default gen_random_uuid(),
  project_id            bigint not null references bw_projects(id) on delete cascade,
  query_id              bigint not null references bw_queries(id) on delete cascade,
  category_id           bigint references bw_categories(id) on delete cascade,
  category_id_key       bigint generated always as (coalesce(category_id, 0)) stored,
  metric_week           date not null,
  total_mentions        integer not null default 0,
  sentiment_positive    integer not null default 0,
  sentiment_neutral     integer not null default 0,
  sentiment_negative    integer not null default 0,
  synced_at             timestamptz not null default now(),
  unique (project_id, query_id, category_id_key, metric_week)
);

alter table bw_query_metrics_weekly enable row level security;

create policy "org_isolation_bw_query_metrics_weekly_select"
  on bw_query_metrics_weekly for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );

create table if not exists bw_query_metrics_monthly (
  id                    uuid primary key default gen_random_uuid(),
  project_id            bigint not null references bw_projects(id) on delete cascade,
  query_id              bigint not null references bw_queries(id) on delete cascade,
  category_id           bigint references bw_categories(id) on delete cascade,
  category_id_key       bigint generated always as (coalesce(category_id, 0)) stored,
  metric_month          date not null,
  total_mentions        integer not null default 0,
  sentiment_positive    integer not null default 0,
  sentiment_neutral     integer not null default 0,
  sentiment_negative    integer not null default 0,
  synced_at             timestamptz not null default now(),
  unique (project_id, query_id, category_id_key, metric_month)
);

alter table bw_query_metrics_monthly enable row level security;

create policy "org_isolation_bw_query_metrics_monthly_select"
  on bw_query_metrics_monthly for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );

-- Share of Voice (breakdown de volume por Query dentro de um Query Group,
-- por semana) — data/volume/queryGroups/weeks. Uma linha por (grupo, query,
-- semana), não por grupo agregado, para permitir comparar candidato x
-- concorrentes direto em SQL (mesmo uso do card de SOV em
-- executive-overview.md).
create table if not exists bw_query_group_metrics_weekly (
  id                uuid primary key default gen_random_uuid(),
  project_id        bigint not null references bw_projects(id) on delete cascade,
  query_group_id    bigint not null references bw_query_groups(id) on delete cascade,
  query_id          bigint not null references bw_queries(id) on delete cascade,
  metric_week       date not null,
  total_mentions    integer not null default 0,
  synced_at         timestamptz not null default now(),
  unique (query_group_id, query_id, metric_week)
);

alter table bw_query_group_metrics_weekly enable row level security;

create policy "org_isolation_bw_query_group_metrics_weekly_select"
  on bw_query_group_metrics_weekly for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );

-- Correção em bw_query_metrics_daily (já migrada em 20260707000000): mesmo
-- bug de NULL <> NULL descrito no topo deste arquivo. Aditivo — não remove a
-- unique constraint antiga (continua válida para linhas com category_id
-- preenchido, só deixa de ser o alvo do upsert), só adiciona a coluna
-- gerada + a constraint correta que o código do bw-sync passa a usar.
alter table bw_query_metrics_daily
  add column if not exists category_id_key bigint generated always as (coalesce(category_id, 0)) stored;

alter table bw_query_metrics_daily
  add constraint bw_query_metrics_daily_category_key_unique
  unique (project_id, query_id, category_id_key, metric_date);
