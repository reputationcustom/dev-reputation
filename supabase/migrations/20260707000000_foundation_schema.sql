-- Módulo: foundation (Sprint 1)
-- Fonte: .dev/specs/foundation/data-model.md ("estrutura final" aprovada em overview.md)
--
-- Duas partes desta migration foram redigidas do zero por não haver DDL
-- original recuperável (o "schema anexo" 20260706_reputation_os_schema.sql
-- citado em data-model.md não existe no repositório nem em outro lugar do
-- disco — confirmado com o usuário antes de escrever esta migration):
--   1. `mentions` (particionada por mês) — ver seção 3.
--   2. `sync_cursors`/`sync_log` — ver seção 4.
-- Em ambos os casos, os campos foram inferidos dos comportamentos já
-- descritos em overview.md/sync-brandwatch.md. Revisar antes de considerar
-- definitivo.
--
-- Resolução de um conflito de spec (reporting vs. PostgREST): ver comentário
-- na seção "Camada de reporting" abaixo.

-- =========================================================================
-- Extensões
-- =========================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "btree_gin";  -- índices GIN combinados (category_ids, tag_names)

-- =========================================================================
-- Enums
-- =========================================================================

create type sentiment_type as enum ('positive', 'negative', 'neutral');

-- Reusado por risk_level e priority em narratives (e futuramente cases,
-- Sprint 2) — evita duplicar o mesmo domínio de 4 valores com nomes diferentes.
create type severity_level as enum ('low', 'medium', 'high', 'critical');

-- Ciclo de vida da Narrativa — sem reuso, tipo novo.
create type narrative_stage as enum ('emerging', 'growing', 'stable', 'crisis', 'declining', 'closed');

-- =========================================================================
-- Funções utilitárias
-- =========================================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================================
-- 1. Multi-tenancy
-- =========================================================================

create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger set_updated_at
  before update on organizations
  for each row execute function set_updated_at();

create table if not exists organization_members (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  created_at        timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists idx_organization_members_user_id on organization_members(user_id);
create index if not exists idx_organization_members_organization_id on organization_members(organization_id);

-- Resolve as organizações do usuário autenticado via organization_members,
-- evitando recursão de RLS (security definer) e permitindo cache por
-- statement (stable). Definida só agora (não lá em cima, junto de
-- set_updated_at) porque, ao contrário de plpgsql, uma função `language sql`
-- tem o corpo validado contra o catálogo já na criação — precisa que
-- organization_members já exista.
create or replace function auth_organization_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select organization_id from organization_members where user_id = auth.uid()
$$;

alter table organizations enable row level security;

-- Sem policy de INSERT/UPDATE/DELETE — criação/edição é operação de backend
-- (SUPABASE_SECRET_KEY), sem UI no MVP.
create policy "org_isolation_organizations_select"
  on organizations for select
  using (id in (select auth_organization_ids()));

alter table organization_members enable row level security;

-- Sem policy de INSERT/DELETE — gestão de membros é manual/backend no MVP
-- (sem coluna de papel/role).
create policy "organization_members_select_own"
  on organization_members for select
  using (user_id = (select auth.uid()));

create table if not exists brandwatch_credentials (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references organizations(id) on delete cascade,
  bw_client_id                text,
  bw_platform_client_id       text,
  access_token_secret_ref     text not null,
  token_expires_at            timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create trigger set_updated_at
  before update on brandwatch_credentials
  for each row execute function set_updated_at();

alter table brandwatch_credentials enable row level security;

-- Só leitura para o frontend (sem UI de gestão de credenciais no MVP) — a
-- Edge Function bw-sync usa SUPABASE_SECRET_KEY e ignora RLS.
create policy "org_isolation_brandwatch_credentials_select"
  on brandwatch_credentials for select
  using (organization_id in (select auth_organization_ids()));

-- =========================================================================
-- 2. Espelho da Brandwatch (cache — só o sync-brandwatch escreve via
--    SUPABASE_SECRET_KEY; políticas abaixo são só-leitura para o frontend)
-- =========================================================================

create table if not exists bw_projects (
  id                bigint primary key,
  organization_id   uuid not null references organizations(id) on delete cascade,
  name              text not null,
  description       text,
  timezone          text,
  synced_at         timestamptz not null default now()
);

alter table bw_projects enable row level security;

create policy "org_isolation_bw_projects_select"
  on bw_projects for select
  using (organization_id in (select auth_organization_ids()));

create table if not exists bw_queries (
  id                  bigint primary key,
  project_id          bigint not null references bw_projects(id) on delete cascade,
  name                text not null,
  boolean_query       text,
  type                text not null default 'monitor',
  content_sources     text[] not null default '{}',
  languages           text[] not null default '{}',
  start_date          date,
  sampled             boolean,
  sample_percentage   numeric,
  synced_at           timestamptz not null default now()
);

create index if not exists idx_bw_queries_project_id on bw_queries(project_id);

alter table bw_queries enable row level security;

-- Organização resolvida via project_id (mesmo padrão de entity_accounts) —
-- sem duplicar organization_id em tabela satélite.
create policy "org_isolation_bw_queries_select"
  on bw_queries for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );

create table if not exists bw_query_groups (
  id            bigint primary key,
  project_id    bigint not null references bw_projects(id) on delete cascade,
  name          text not null,
  query_ids     bigint[] not null default '{}',
  synced_at     timestamptz not null default now()
);

create index if not exists idx_bw_query_groups_project_id on bw_query_groups(project_id);

alter table bw_query_groups enable row level security;

create policy "org_isolation_bw_query_groups_select"
  on bw_query_groups for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );

create table if not exists bw_categories (
  id                bigint primary key,
  project_id        bigint not null references bw_projects(id) on delete cascade,
  parent_id         bigint references bw_categories(id) on delete cascade,
  name              text not null,
  matching_type     text,
  synced_at         timestamptz not null default now()
);

create index if not exists idx_bw_categories_project_id on bw_categories(project_id);
create index if not exists idx_bw_categories_parent_id on bw_categories(parent_id);

alter table bw_categories enable row level security;

create policy "org_isolation_bw_categories_select"
  on bw_categories for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );

-- =========================================================================
-- 3. Mentions (particionada por mês)
--
-- DDL redigida do zero (ver nota no topo do arquivo) a partir dos campos
-- documentados em data-model.md §3 e do comportamento de dedup descrito em
-- overview.md ("deduplicando por (queryId, resourceId) via
-- idx_mentions_natural_key"). sync-brandwatch.md menciona um índice de 4
-- colunas (project_id, query_id, resource_id, added) para o mesmo fim — a
-- versão de overview.md (status `pronto`, mais autoritativa) foi seguida;
-- `mention_date` entra também por exigência do Postgres (toda unique index
-- de tabela particionada precisa incluir a chave de partição).
-- =========================================================================

create table if not exists mentions (
  id                          uuid not null default gen_random_uuid(),
  organization_id             uuid not null references organizations(id) on delete cascade,
  project_id                  bigint not null references bw_projects(id) on delete cascade,
  query_id                    bigint not null references bw_queries(id) on delete cascade,
  resource_id                 text not null,
  category_ids                bigint[] not null default '{}',
  tag_names                   text[] not null default '{}',
  sentiment                   sentiment_type,
  author                      text,
  author_handle_normalized    text generated always as (lower(author)) stored,
  reach_estimate              integer,
  domain                      text,
  snippet                     text,
  full_text                   text,
  added                       timestamptz not null,
  mention_date                date not null,
  raw                         jsonb not null default '{}',
  created_at                  timestamptz not null default now(),
  primary key (id, mention_date)
) partition by range (mention_date);

create unique index if not exists idx_mentions_natural_key
  on mentions (query_id, resource_id, mention_date);

create index if not exists idx_mentions_organization_id on mentions (organization_id, mention_date);
create index if not exists idx_mentions_domain on mentions (domain);
create index if not exists idx_mentions_author_handle on mentions (author_handle_normalized);
create index if not exists idx_mentions_category_ids on mentions using gin (category_ids);
create index if not exists idx_mentions_tag_names on mentions using gin (tag_names);

alter table mentions enable row level security;

-- Só leitura para o frontend — só o sync-brandwatch escreve (SUPABASE_SECRET_KEY).
create policy "org_isolation_mentions_select"
  on mentions for select
  using (organization_id in (select auth_organization_ids()));

-- Helper de particionamento — cria a partição mensal se ainda não existir.
-- Uso em produção: agendar via pg_cron (ex: mensal) para criar a partição do
-- próximo mês com antecedência; não incluído no agendamento pg_cron desta
-- migration (fica para quando o deploy real for configurado).
create or replace function create_mentions_partition(p_month date)
returns void
language plpgsql
as $$
declare
  partition_start date := date_trunc('month', p_month)::date;
  partition_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  partition_name  text := 'mentions_' || to_char(partition_start, 'YYYY_MM');
begin
  execute format(
    'create table if not exists %I partition of mentions for values from (%L) to (%L)',
    partition_name, partition_start, partition_end
  );
end;
$$;

select create_mentions_partition(current_date);
select create_mentions_partition((current_date + interval '1 month')::date);

-- =========================================================================
-- 4. Operacional — cursores e log
--
-- DDL redigida do zero (ver nota no topo do arquivo) a partir dos campos
-- citados em overview.md/sync-brandwatch.md: sync_cursors
-- (last_added_cursor, last_synced_at, status, last_error) e sync_log
-- (status, rows_processed, error_message).
-- =========================================================================

create table if not exists sync_cursors (
  id                   uuid primary key default gen_random_uuid(),
  project_id           bigint not null references bw_projects(id) on delete cascade,
  query_id             bigint not null references bw_queries(id) on delete cascade,
  last_added_cursor    timestamptz,
  last_synced_at       timestamptz,
  status               text not null default 'idle',
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (project_id, query_id)
);

create trigger set_updated_at
  before update on sync_cursors
  for each row execute function set_updated_at();

create index if not exists idx_sync_cursors_last_synced_at on sync_cursors(last_synced_at);

-- Deny-all: só SUPABASE_SECRET_KEY (bypassa RLS) acessa. RLS habilitada sem
-- nenhuma policy para satisfazer o Database Linter do Supabase.
alter table sync_cursors enable row level security;

create table if not exists sync_log (
  id                uuid primary key default gen_random_uuid(),
  project_id        bigint references bw_projects(id) on delete cascade,
  query_id          bigint references bw_queries(id) on delete cascade,
  status            text not null,
  rows_processed    integer not null default 0,
  error_message     text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_sync_log_created_at on sync_log(created_at);

-- Deny-all, mesmo padrão de sync_cursors.
alter table sync_log enable row level security;

-- =========================================================================
-- 5. Agregados oficiais da Brandwatch (sampling-safe)
-- =========================================================================

create table if not exists bw_query_metrics_daily (
  id                    uuid primary key default gen_random_uuid(),
  project_id            bigint not null references bw_projects(id) on delete cascade,
  query_id              bigint not null references bw_queries(id) on delete cascade,
  category_id           bigint references bw_categories(id) on delete cascade,
  metric_date           date not null,
  total_mentions        integer not null default 0,
  sentiment_positive    integer not null default 0,
  sentiment_neutral     integer not null default 0,
  sentiment_negative    integer not null default 0,
  synced_at             timestamptz not null default now(),
  unique (project_id, query_id, category_id, metric_date)
);

alter table bw_query_metrics_daily enable row level security;

create policy "org_isolation_bw_query_metrics_daily_select"
  on bw_query_metrics_daily for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );

-- =========================================================================
-- 6. Narrativas (entidade viva)
-- =========================================================================

create table if not exists narratives (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  bw_category_id    bigint references bw_categories(id),
  title             text not null,
  description       text,
  stage             narrative_stage not null default 'emerging',
  risk_level        severity_level not null default 'low',
  priority          severity_level not null default 'medium',
  first_seen_at     timestamptz,
  last_seen_at      timestamptz,
  owner             text,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_narratives_organization_id_stage on narratives(organization_id, stage);
create index if not exists idx_narratives_bw_category_id on narratives(bw_category_id) where bw_category_id is not null;

create trigger set_updated_at
  before update on narratives
  for each row execute function set_updated_at();

alter table narratives enable row level security;

-- Narrativas são curadas manualmente por um analista (sem UI no Sprint 1,
-- mesmo padrão de população manual de organization_members) — policy cobre
-- todas as operações, ao contrário das tabelas de cache (só-leitura).
create policy "org_isolation_narratives_all"
  on narratives for all
  using (organization_id in (select auth_organization_ids()))
  with check (organization_id in (select auth_organization_ids()));

create table if not exists narrative_signals (
  id              uuid primary key default gen_random_uuid(),
  narrative_id    uuid not null references narratives(id) on delete cascade,
  signal_type     text not null,
  signal_value    text not null,
  weight          numeric not null default 1,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create index if not exists idx_narrative_signals_type_value on narrative_signals(signal_type, signal_value);
create index if not exists idx_narrative_signals_narrative_id on narrative_signals(narrative_id);

alter table narrative_signals enable row level security;

create policy "org_isolation_narrative_signals_all"
  on narrative_signals for all
  using (
    narrative_id in (
      select id from narratives where organization_id in (select auth_organization_ids())
    )
  )
  with check (
    narrative_id in (
      select id from narratives where organization_id in (select auth_organization_ids())
    )
  );

create table if not exists narrative_tags (
  id              uuid primary key default gen_random_uuid(),
  narrative_id    uuid not null references narratives(id) on delete cascade,
  tag_type        text not null,
  tag_value       text not null,
  unique (narrative_id, tag_type, tag_value)
);

create index if not exists idx_narrative_tags_type_value on narrative_tags(tag_type, tag_value);

alter table narrative_tags enable row level security;

create policy "org_isolation_narrative_tags_all"
  on narrative_tags for all
  using (
    narrative_id in (
      select id from narratives where organization_id in (select auth_organization_ids())
    )
  )
  with check (
    narrative_id in (
      select id from narratives where organization_id in (select auth_organization_ids())
    )
  );

create table if not exists narrative_metrics (
  id                    uuid primary key default gen_random_uuid(),
  narrative_id          uuid not null references narratives(id) on delete cascade,
  metric_date           date not null,
  period                text not null default 'daily',
  source                text not null,
  total_mentions        integer not null default 0,
  unique_authors        integer,
  sentiment_positive    integer not null default 0,
  sentiment_neutral     integer not null default 0,
  sentiment_negative    integer not null default 0,
  reach_estimated       integer,
  top_domain            text,
  created_at            timestamptz not null default now(),
  unique (narrative_id, metric_date, period),
  constraint narrative_metrics_source_check check (source in ('bw_aggregate', 'mentions_sample'))
);

alter table narrative_metrics enable row level security;

-- Só leitura para o frontend — populada por refresh_narrative_metrics()
-- (pg_cron), não por escrita direta do usuário.
create policy "org_isolation_narrative_metrics_select"
  on narrative_metrics for select
  using (
    narrative_id in (
      select id from narratives where organization_id in (select auth_organization_ids())
    )
  );

-- =========================================================================
-- Função: narrative_matched_mentions
--
-- Definição única de "quais mentions pertencem a uma Narrativa" — todo
-- consumidor futuro (refresh_narrative_metrics, narrative_entities no
-- Sprint 2, drill-down do Intelligence Center) deve reusar esta função.
-- Rascunho de referência (ver ressalva em data-model.md): ilike sobre
-- snippet/full_text sem índice de texto é aceitável no volume do MVP, mas
-- precisa de índice antes de qualquer narrativa com sinal `keyword` rodar
-- sobre milhões de mentions.
-- =========================================================================

create or replace function narrative_matched_mentions(
  p_narrative_id uuid,
  p_since timestamptz default null,
  p_until timestamptz default null
)
returns setof mentions
language sql
stable
as $$
  select m.*
  from mentions m
  join narratives n on n.id = p_narrative_id
  where m.organization_id = n.organization_id
    and (p_since is null or m.mention_date >= p_since)
    and (p_until is null or m.mention_date < p_until)
    and (
      (n.bw_category_id is not null and n.bw_category_id = any(m.category_ids))
      or exists (
        select 1 from narrative_signals s
        where s.narrative_id = p_narrative_id
          and s.is_active
          and (
            (s.signal_type = 'author_handle' and m.author_handle_normalized = lower(s.signal_value))
            or (s.signal_type = 'domain' and m.domain = s.signal_value)
            or (s.signal_type = 'hashtag' and s.signal_value = any(m.tag_names))
            or (s.signal_type = 'keyword' and (
                  m.snippet ilike '%' || s.signal_value || '%'
                  or m.full_text ilike '%' || s.signal_value || '%'
                ))
          )
      )
    )
$$;

-- =========================================================================
-- Função: refresh_narrative_metrics
--
-- Chamada direto pelo pg_cron (sem Edge Function). Prioriza bw_aggregate
-- quando a Narrativa tem bw_category_id; cai para agregação local
-- (mentions_sample) quando não tem.
-- =========================================================================

create or replace function refresh_narrative_metrics(p_metric_date date default current_date - 1)
returns void
language plpgsql
as $$
begin
  -- Via 1: agregado oficial da Brandwatch (Narrativas com bw_category_id)
  insert into narrative_metrics (
    narrative_id, metric_date, period, source,
    total_mentions, sentiment_positive, sentiment_neutral, sentiment_negative
  )
  select n.id, q.metric_date, 'daily', 'bw_aggregate',
         q.total_mentions, q.sentiment_positive, q.sentiment_neutral, q.sentiment_negative
  from narratives n
  join bw_query_metrics_daily q
    on q.category_id = n.bw_category_id and q.metric_date = p_metric_date
  where n.bw_category_id is not null
  on conflict (narrative_id, metric_date, period) do update set
    source = excluded.source,
    total_mentions = excluded.total_mentions,
    sentiment_positive = excluded.sentiment_positive,
    sentiment_neutral = excluded.sentiment_neutral,
    sentiment_negative = excluded.sentiment_negative;

  -- Via 2: agregação local (Narrativas só com sinais, sem bw_category_id)
  insert into narrative_metrics (
    narrative_id, metric_date, period, source,
    total_mentions, unique_authors, sentiment_positive, sentiment_neutral,
    sentiment_negative, reach_estimated, top_domain
  )
  select
    n.id, p_metric_date, 'daily', 'mentions_sample',
    count(*),
    count(distinct m.author_handle_normalized),
    count(*) filter (where m.sentiment = 'positive'),
    count(*) filter (where m.sentiment = 'neutral'),
    count(*) filter (where m.sentiment = 'negative'),
    sum(m.reach_estimate),
    mode() within group (order by m.domain)
  from narratives n
  join lateral narrative_matched_mentions(
    n.id, p_metric_date::timestamptz, (p_metric_date + 1)::timestamptz
  ) m on true
  where n.bw_category_id is null
  group by n.id
  on conflict (narrative_id, metric_date, period) do update set
    source = excluded.source,
    total_mentions = excluded.total_mentions,
    unique_authors = excluded.unique_authors,
    sentiment_positive = excluded.sentiment_positive,
    sentiment_neutral = excluded.sentiment_neutral,
    sentiment_negative = excluded.sentiment_negative,
    reach_estimated = excluded.reach_estimated,
    top_domain = excluded.top_domain;
end;
$$;

-- =========================================================================
-- Camada de reporting (BI externo) + view de consumo do frontend
--
-- Conflito de spec identificado e resolvido (ver .dev/specs/foundation/
-- executive-overview.md vs. _index.md Princípio técnico 6): o frontend
-- (via @supabase/ssr / PostgREST) só enxerga schemas em `db.schemas`
-- (supabase/config.toml: ["public", "graphql_public"]) — `reporting`
-- deliberadamente NÃO entra nessa lista (Princípio técnico 6: só acessível
-- via conexão Postgres direta). Então a view que o Executive Overview
-- consome vive em `public`; `reporting.narratives_overview` é uma view fina
-- por cima dela, só para o `bi_reader` via conexão direta.
-- =========================================================================

create or replace view public.narratives_overview as
with daily as (
  select narrative_id, metric_date, total_mentions,
         sentiment_positive, sentiment_neutral, sentiment_negative,
         lag(total_mentions) over (partition by narrative_id order by metric_date) as prev_total_mentions
  from narrative_metrics
  where period = 'daily'
),
org_totals as (
  select nm.metric_date, n.organization_id, sum(nm.total_mentions) as org_total_mentions
  from narrative_metrics nm
  join narratives n on n.id = nm.narrative_id
  where nm.period = 'daily'
  group by nm.metric_date, n.organization_id
)
select
  n.id as narrative_id,
  n.organization_id,
  n.title,
  n.stage,
  n.risk_level,
  d.metric_date,
  d.total_mentions,
  round(100.0 * d.total_mentions / nullif(t.org_total_mentions, 0), 1) as sov_percent,
  round(100.0 * (d.total_mentions - d.prev_total_mentions) / nullif(d.prev_total_mentions, 0), 1) as trend_percent,
  case
    when d.total_mentions = 0 then 'neutral'
    when (d.sentiment_positive - d.sentiment_negative)::numeric / d.total_mentions > 0.2 then 'positive'
    when (d.sentiment_positive - d.sentiment_negative)::numeric / d.total_mentions < -0.2 then 'negative'
    else 'neutral'
  end as sentiment_bucket
from narratives n
join daily d on d.narrative_id = n.id
join org_totals t on t.metric_date = d.metric_date and t.organization_id = n.organization_id;

comment on view public.narratives_overview is
  'View usada pela tabela interativa de Narrativas no Executive Overview (via PostgREST/RLS). Thresholds de sentiment_bucket (±20%) e o bucket de Momentum (calculado no frontend a partir de trend_percent) são placeholders — ver ⚠️ DECISÃO PENDENTE em overview.md. RLS das tabelas base (narratives/narrative_metrics) se aplica normalmente pois é uma view sem security_invoker/definer especial.';

create schema if not exists reporting;

create or replace view reporting.mentions_daily as
select project_id, query_id, category_id, metric_date,
       total_mentions, sentiment_positive, sentiment_neutral, sentiment_negative
from bw_query_metrics_daily;

comment on view reporting.mentions_daily is
  'Volume/sentimento diário por Query/Category, direto dos agregados oficiais da Brandwatch (não amostrado). Uso: BI externo via bi_reader, conexão Postgres direta.';

create or replace view reporting.narratives_overview as
select * from public.narratives_overview;

comment on view reporting.narratives_overview is
  'Espelho de public.narratives_overview para BI externo via bi_reader (conexão Postgres direta). bi_reader tem bypassrls — enxerga todas as organizações por design (uso interno da Lidi, ver Princípio técnico 6 em _index.md); não confundir com acesso multi-tenant seguro.';

-- Role só-leitura para BI externo (Qlik Cloud, Power BI, ferramentas próprias).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'bi_reader') then
    create role bi_reader login noinherit;
  end if;
end
$$;

-- bypassrls é o que permite ao bi_reader ver todas as organizações através
-- das views de reporting (que consultam tabelas com RLS ativa) — sem isso,
-- uma role comum sem sessão de Supabase Auth não enxergaria nenhuma linha.
-- Senha real deve ser gerada e guardada fora do repositório (gestor de
-- segredos), nunca commitada:
--   alter role bi_reader password '<gerar e rotacionar externamente>';
alter role bi_reader bypassrls;
grant usage on schema reporting to bi_reader;
grant select on all tables in schema reporting to bi_reader;
alter default privileges in schema reporting grant select on tables to bi_reader;
revoke all on schema public from bi_reader;

-- `reporting` não deve entrar em `db.schemas` (Settings → API → Exposed
-- schemas) no dashboard do Supabase em produção — já não entra em
-- supabase/config.toml local (schemas = ["public", "graphql_public"]).
