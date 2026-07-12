-- Validação de spec contra um export real de dashboard Brandwatch
-- (2026-07-11): "Top X Authors | Government Verification"/"Business
-- Verification (Only brands)" e "Top Authors | Estados"/"Cidades" (Flávio)
-- usam campos que a Brandwatch já devolve no payload de Top Authors
-- (confirmado em developers.brandwatch.com/docs/top-tweeters:
-- authorAccountType, countryCode, countryName, twitterTweets,
-- twitterRetweets) mas que só viviam dentro de bw_query_top_authors.
-- platform_stats (jsonb), sem coluna própria. Nenhuma chamada nova —
-- só extração de campos já capturados.
--
-- Também adiciona bw_query_top_sites: "Top Site" no export é um ranking
-- de domínios/sites (data/volume/topsites/queries, doc top-sites),
-- distinto de "Top Authors" (contas de redes sociais) — gap real, não
-- coberto ainda. Mesmo padrão de bw_query_top_authors (payload quase
-- idêntico, confirmado contra a doc).

alter table bw_query_top_authors
  add column if not exists tweets integer,
  add column if not exists retweets integer,
  add column if not exists account_type text,
  add column if not exists country_code text,
  add column if not exists country_name text;

create table if not exists bw_query_top_sites (
  id                 uuid primary key default gen_random_uuid(),
  project_id         bigint not null references bw_projects(id) on delete cascade,
  query_id           bigint not null references bw_queries(id) on delete cascade,
  category_id        bigint references bw_categories(id) on delete cascade,
  category_id_key    bigint generated always as (coalesce(category_id, 0)) stored,
  domain             text not null,
  volume             integer not null default 0,
  monthly_visitors   integer,
  reach_estimate     integer,
  impact             numeric,
  author_name        text,
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
  unique (project_id, query_id, category_id_key, domain, metric_week)
);

create trigger set_updated_at
  before update on bw_query_top_sites
  for each row execute function set_updated_at();

alter table bw_query_top_sites enable row level security;

create policy org_isolation_bw_query_top_sites on bw_query_top_sites
  for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );
