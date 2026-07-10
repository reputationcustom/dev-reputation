-- Ampliação de captura de dados pedida pelo usuário (mockup de "Relatório de
-- Insights"): mentions ganha campos confirmados via
-- developers.brandwatch.com/docs/mention-metadata-field-definitions
-- (pesquisado nesta sessão, não só o resumo curado da skill brandwatch-api)
-- + duas tabelas novas para endpoints de agregado até então não usados:
-- data/topics (temas com sentimento/volume/trending — o mecanismo nativo
-- da Brandwatch mais próximo de "clusters temáticos", sem precisar de
-- embeddings/HDBSCAN próprios) e data/volume/topauthors/queries (ranking
-- nativo de autores, melhor que calcular localmente sobre a amostra
-- sincronizada). Ver .dev/specs/foundation/sync-brandwatch.md e
-- data-model.md para o desenho completo.

alter table mentions
  add column if not exists gender               text,
  add column if not exists country_code         text,
  add column if not exists region               text,
  add column if not exists city                 text,
  add column if not exists continent_code       text,
  -- pageType no objeto de mention está deprecated pela Brandwatch — usar
  -- contentSource. Mantido nullable pois nem toda fonte preenche.
  add column if not exists content_source       text,
  add column if not exists language             text,
  add column if not exists impressions          integer,
  -- impact: métrica logarítmica 0-100 da Brandwatch, cross-platform — a
  -- métrica de referência pra ranking de influência (junto com
  -- reach_estimate, já existente), evita depender de contar seguidores
  -- por rede social específica.
  add column if not exists impact               numeric,
  -- Array bruto de classificações (inclui emoção como {name, confidence}).
  -- Guardado como jsonb (não text[]) porque cada item tem múltiplos campos.
  add column if not exists classifications      jsonb not null default '[]',
  -- Best-effort: primeiro classifier de emoção encontrado em
  -- `classifications`, extraído em bw-sync (upsertMentions()) — não é um
  -- campo direto da API, é uma conveniência de leitura.
  add column if not exists emotion              text,
  -- insightsHashtag/insightsMentioned: específicos de X/Instagram.
  add column if not exists insights_hashtag     text[] not null default '{}',
  add column if not exists insights_mentioned   text[] not null default '{}',
  add column if not exists reply_to             text,
  add column if not exists retweet_of           text,
  -- Engajamento é por plataforma sem campo genérico (twitterFollowers,
  -- instagramLikeCount, facebookShares, tiktokLikes, blueskyReposts,
  -- linkedinComments etc. — ~20 campos possíveis). Guardado como jsonb
  -- compacto (só as chaves de engajamento presentes na mention, extraídas
  -- do raw) em vez de uma coluna tipada por campo — não há consumidor
  -- ainda que justifique tipar todos; impact/reach_estimate já cobrem
  -- ranking cross-platform.
  add column if not exists engagement           jsonb not null default '{}';

create index if not exists idx_mentions_content_source on mentions(content_source);
create index if not exists idx_mentions_classifications on mentions using gin (classifications);
create index if not exists idx_mentions_insights_hashtag on mentions using gin (insights_hashtag);

-- =========================================================================
-- Breakdown diário de volume por plataforma (data/volume/pageTypes/days —
-- dimensão de chart "pageTypes", plural; distinto do campo de mention
-- "pageType", deprecated). Sampling-safe, mesmo padrão de
-- bw_query_metrics_daily.
-- =========================================================================

create table if not exists bw_query_metrics_daily_by_platform (
  id                uuid primary key default gen_random_uuid(),
  project_id        bigint not null references bw_projects(id) on delete cascade,
  query_id          bigint not null references bw_queries(id) on delete cascade,
  page_type         text not null,
  metric_date       date not null,
  total_mentions    integer not null default 0,
  synced_at         timestamptz not null default now(),
  unique (project_id, query_id, page_type, metric_date)
);

alter table bw_query_metrics_daily_by_platform enable row level security;

create policy "org_isolation_bw_query_metrics_daily_by_platform_select"
  on bw_query_metrics_daily_by_platform for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );

-- =========================================================================
-- Temas extraídos via data/topics (extract=words,phrases,hashtags,entities,
-- people,places,organisations; metrics=volume,percentageVolume,sentiment,
-- trending). Throttle semanal (dado lento, mesmo padrão de
-- bw_query_metrics_weekly) — daí metric_week, não metric_date.
-- category_id_key: mesmo padrão de bw_query_metrics_daily/weekly/monthly
-- (migration 20260707030000) para evitar o bug de NULL <> NULL em unique
-- constraint com coluna nullable.
-- =========================================================================

create table if not exists bw_query_topics (
  id                    uuid primary key default gen_random_uuid(),
  project_id            bigint not null references bw_projects(id) on delete cascade,
  query_id              bigint not null references bw_queries(id) on delete cascade,
  category_id           bigint references bw_categories(id) on delete cascade,
  category_id_key       bigint generated always as (coalesce(category_id, 0)) stored,
  topic_type            text not null,
  label                 text not null,
  volume                integer not null default 0,
  percentage_volume     numeric,
  sentiment_positive    integer not null default 0,
  sentiment_neutral     integer not null default 0,
  sentiment_negative    integer not null default 0,
  trending              numeric,
  metric_week           date not null,
  synced_at             timestamptz not null default now(),
  unique (project_id, query_id, category_id_key, topic_type, label, metric_week)
);

alter table bw_query_topics enable row level security;

create policy "org_isolation_bw_query_topics_select"
  on bw_query_topics for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );

-- =========================================================================
-- Ranking de autores via data/volume/topauthors/queries (até 1000,
-- default 10 — bw-sync pede limit=100). Throttle semanal, mesmo motivo de
-- bw_query_topics. platform_stats guarda o payload de engajamento
-- específico por plataforma que o endpoint retorna por autor (mesmo
-- raciocínio de mentions.engagement — sem coluna por campo).
-- =========================================================================

create table if not exists bw_query_top_authors (
  id                    uuid primary key default gen_random_uuid(),
  project_id            bigint not null references bw_projects(id) on delete cascade,
  query_id              bigint not null references bw_queries(id) on delete cascade,
  author                text not null,
  volume                integer not null default 0,
  reach_estimate        integer,
  impact                numeric,
  sentiment_positive    integer not null default 0,
  sentiment_neutral     integer not null default 0,
  sentiment_negative    integer not null default 0,
  platform_stats        jsonb not null default '{}',
  metric_week           date not null,
  synced_at             timestamptz not null default now(),
  unique (project_id, query_id, author, metric_week)
);

alter table bw_query_top_authors enable row level security;

create policy "org_isolation_bw_query_top_authors_select"
  on bw_query_top_authors for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );
