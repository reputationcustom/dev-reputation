-- Pedido do usuário (2026-07-12): "termine integração do top-tweeters...
-- considere esses dois endpoints como informações distintas, porém
-- igualmente importantes" (top-authors vs top-tweeters) + auditoria de
-- topics/data-topics/top-sites/top-shared-sites/top-shared-urls.
--
-- Achados, ver foundation/data-model.md pro racional completo:
-- 1. `data/volume/toptweeters/queries` é um endpoint PRÓPRIO, distinto de
--    `data/volume/topauthors/queries` (já implementado) — ranking
--    específico de autores de X, não uma segunda doc do mesmo endpoint.
--    Nova tabela bw_query_top_tweeters, mesma estrutura de
--    bw_query_top_authors.
-- 2. "Topics" legado (`data/volume/topics/queries`) é DIFERENTE de "Topics
--    (New)" (`data/topics`, já implementado como bw_query_topics) — só o
--    legado tem os campos `days`/`pageType`/`burst` que uma revisão de
--    spec anterior (2026-07-11) tinha planejado como
--    daily_series/page_type_breakdown, mas atribuído erroneamente ao
--    endpoint novo (que não tem esses campos). bw_query_topics ganha as 3
--    colunas, agora corretamente associadas ao endpoint legado.
-- 3. `data/sharedsites` ("Top Shared Sites") é distinto de
--    `data/volume/topsites/queries` ("Top Sites", já implementado) —
--    mede domínios mais COMPARTILHADOS/linkados dentro das mentions, não
--    domínios de onde as mentions vêm. Nova tabela bw_query_top_shared_sites.
-- 4. "Top Shared URLs" (`data/urls`) é o MESMO endpoint que "Stories" de
--    X (Twitter) Insights, já implementado em bw_query_x_insights
--    (insight_type='url') — sem gap, só uma nota de documentação.

-- ---------------------------------------------------------------------
-- 1. bw_query_top_tweeters — mesma estrutura de bw_query_top_authors,
--    tabela própria (não reaproveita a mesma linha/chave de
--    bw_query_top_authors: um autor pode aparecer nos dois rankings com
--    métricas potencialmente diferentes, já que o universo de ranking é
--    diferente).
-- ---------------------------------------------------------------------

create table if not exists bw_query_top_tweeters (
  id                 uuid primary key default gen_random_uuid(),
  project_id         bigint not null references bw_projects(id) on delete cascade,
  query_id           bigint not null references bw_queries(id) on delete cascade,
  category_id        bigint references bw_categories(id) on delete cascade,
  category_id_key    bigint generated always as (coalesce(category_id, 0)) stored,
  author             text not null,
  volume             integer not null default 0,
  reach_estimate     bigint,
  impact             numeric,
  followers          integer,
  is_influential     boolean generated always as (coalesce(followers, 0) >= 100000) stored,
  tweets             integer,
  retweets           integer,
  account_type       text,
  country_code       text,
  country_name       text,
  sentiment_positive integer not null default 0,
  sentiment_neutral  integer not null default 0,
  sentiment_negative integer not null default 0,
  platform_stats     jsonb not null default '{}',
  metric_week        date not null,
  synced_at          timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (project_id, query_id, category_id_key, author, metric_week)
);

create index if not exists idx_bw_query_top_tweeters_influential
  on bw_query_top_tweeters (project_id, query_id, is_influential) where is_influential;

create trigger set_updated_at
  before update on bw_query_top_tweeters
  for each row execute function set_updated_at();

alter table bw_query_top_tweeters enable row level security;

create policy org_isolation_bw_query_top_tweeters on bw_query_top_tweeters
  for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );

-- ---------------------------------------------------------------------
-- 2. bw_query_topics ganha os campos do endpoint LEGADO (data/volume/
--    topics/queries) — days -> daily_series, pageType -> page_type_breakdown,
--    burst -> burst (métrica própria, escala diferente de `trending`, que
--    vem do endpoint novo). Populados só para topic_type = 'legacy_mixed'
--    (linhas do endpoint legado); topic_type de extract= (words/phrases/
--    hashtags/entities/people/places/organisations, do endpoint novo)
--    continuam com essas 3 colunas null.
-- ---------------------------------------------------------------------

alter table bw_query_topics
  add column if not exists daily_series jsonb,
  add column if not exists page_type_breakdown jsonb,
  add column if not exists burst numeric;

-- ---------------------------------------------------------------------
-- 3. bw_query_top_shared_sites — data/sharedsites, shape simples (mesma
--    família de bw_query_x_insights, mas não é X-specific e vive fora da
--    tabela de X Insights por isso).
-- ---------------------------------------------------------------------

create table if not exists bw_query_top_shared_sites (
  id              uuid primary key default gen_random_uuid(),
  project_id      bigint not null references bw_projects(id) on delete cascade,
  query_id        bigint not null references bw_queries(id) on delete cascade,
  category_id     bigint references bw_categories(id) on delete cascade,
  category_id_key bigint generated always as (coalesce(category_id, 0)) stored,
  domain          text not null,
  label           text,
  volume          integer not null default 0,
  tweets          integer,
  retweets        integer,
  impressions     bigint,
  metric_week     date not null,
  synced_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_id, query_id, category_id_key, domain, metric_week)
);

create trigger set_updated_at
  before update on bw_query_top_shared_sites
  for each row execute function set_updated_at();

alter table bw_query_top_shared_sites enable row level security;

create policy org_isolation_bw_query_top_shared_sites on bw_query_top_shared_sites
  for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );

-- ---------------------------------------------------------------------
-- 4. Novas fases `top_tweeters`/`top_shared_sites` em SYNC_STEPS.
-- ---------------------------------------------------------------------

alter table sync_cursors drop constraint if exists sync_cursors_next_step_check;
alter table sync_cursors
  add constraint sync_cursors_next_step_check
  check (next_step in (
    'metadata', 'mentions', 'daily_metrics', 'weekly_monthly', 'topics',
    'platform_by_narrative', 'x_insights', 'top_authors', 'top_tweeters',
    'author_enrichment', 'top_sites', 'top_shared_sites', 'demographics', 'sov'
  ));
