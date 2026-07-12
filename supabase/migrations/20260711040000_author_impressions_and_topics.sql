-- Pedido do usuário (2026-07-11): "Impressões por autor e temas por autor.
-- Incluir no MVP e garantir que temos informações suficientes vindas da
-- Brandwatch no formato correto."
--
-- A leitura inicial desta mesma revisão de spec tinha concluído que nenhum
-- dos dois tinha fonte oficial não amostrada (Top Authors não expõe
-- impressões; data/topics é agregado por Query/Category inteira, não por
-- autor) — corrigida depois de pesquisa mais a fundo:
--   - `impressions` é um agregado de chart oficial documentado em
--     developers.brandwatch.com/docs/chart-dimensions-and-aggregates
--     (mesma tabela que já confirmou reachEstimate/engagementScore, já
--     usados neste projeto).
--   - O filtro `author=<handle>` é documentado em available-filters.md
--     como válido em "Mention ou Data Retrieval calls" — mesmo nível de
--     evidência genérica já aceito neste projeto pro filtro `category=<id>`
--     usado em data/volume/sentiment/days, data/topics e
--     data/volume/topauthors/queries.
-- Combinando os dois: data/impressions/queries/days?queryId=X&author=<handle>
-- (mesmo padrão de dimensão `queries` já usado em syncQueryGroupSov(),
-- data/volume/queries/weeks?queryGroupId=X) e
-- data/topics?queryId=X&author=<handle> dão dado oficial não amostrado
-- filtrado por autor — quem agrega é o motor de agregados da própria
-- Brandwatch, não um cálculo nosso sobre `mentions` (amostrada), então não
-- viola a premissa fixada em 20260711010000.
--
-- Escopo inicial: só os top 10 autores por volume da Query inteira
-- (category_id is null) — salvaguarda de orçamento, ver
-- sync-brandwatch.md passo 6.7 e supabase/functions/bw-sync/index.ts.

alter table bw_query_top_authors
  add column if not exists impressions integer;

comment on column bw_query_top_authors.impressions is
  'Soma das impressões diárias do autor via data/impressions/queries/days?author=<handle> — agregado oficial da Brandwatch filtrado por autor, não somado localmente sobre mentions.';

create table if not exists bw_query_author_topics (
  id                 uuid primary key default gen_random_uuid(),
  project_id         bigint not null references bw_projects(id) on delete cascade,
  query_id           bigint not null references bw_queries(id) on delete cascade,
  author             text not null,
  topic_type         text not null,
  label              text not null,
  volume             integer not null default 0,
  percentage_volume  numeric,
  sentiment_positive integer not null default 0,
  sentiment_neutral  integer not null default 0,
  sentiment_negative integer not null default 0,
  trending           numeric,
  metric_week        date not null,
  synced_at          timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (project_id, query_id, author, topic_type, label, metric_week)
);

create trigger set_updated_at
  before update on bw_query_author_topics
  for each row execute function set_updated_at();

alter table bw_query_author_topics enable row level security;

create policy org_isolation_bw_query_author_topics on bw_query_author_topics
  for select
  using (
    project_id in (
      select id from bw_projects where organization_id in (select auth_organization_ids())
    )
  );

-- Nova fase `author_enrichment` na execução em fases de bw-sync (migration
-- 20260711030000) — inserida entre `top_authors` e `sov` em SYNC_STEPS.
alter table sync_cursors drop constraint if exists sync_cursors_next_step_check;
alter table sync_cursors
  add constraint sync_cursors_next_step_check
  check (next_step in (
    'metadata', 'mentions', 'daily_metrics', 'weekly_monthly', 'topics',
    'top_authors', 'author_enrichment', 'sov'
  ));
