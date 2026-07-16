-- Módulo `entities` (Cadastro de Entidades) — .dev/specs/entities/data-model.md
--
-- Catálogo GLOBAL (sem organization_id) de pessoas/veículos de imprensa/
-- partidos/instituições/empresas/movimentos relevantes ao debate público
-- monitorado, com classificação EAV extensível (entity_tags) e contas por
-- plataforma (entity_accounts) que habilitam o vínculo aditivo com o
-- ranking de Autores e Influenciadores (get_authors_ranking, ver
-- .dev/specs/entities/author-linking.md). CRUD restrito a admins
-- (is_current_user_admin(), já existente em auth) — leitura aberta a
-- qualquer usuário autenticado, mesmo padrão de communication_types.

-- =========================================================================
-- 1. entity_type — estrutural, poucos valores, não se espera que cresça
-- (mesma categoria de decisão já usada para communication_record_type).
-- =========================================================================

create type entity_type as enum (
  'person', 'media_outlet', 'party', 'institution', 'company', 'movement', 'other'
);

-- =========================================================================
-- 2. entities
-- =========================================================================

create table if not exists entities (
  id                uuid primary key default gen_random_uuid(),
  type              entity_type not null,
  name              text not null,
  description       text,
  photo_url         text,
  influence_level   severity_level,
  is_active         boolean not null default true,
  created_by        uuid references user_profiles(id),
  updated_by        uuid references user_profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_entities_name on entities(name);
create index if not exists idx_entities_type on entities(type);
create index if not exists idx_entities_is_active on entities(is_active);

create trigger set_updated_at
  before update on entities
  for each row execute function set_updated_at();

alter table entities enable row level security;

-- Catálogo global — leitura aberta a qualquer autenticado, mesmo padrão de
-- communication_types (communications/data-model.md).
create policy "entities: leitura autenticada"
  on entities for select
  using (auth.role() = 'authenticated');

create policy "entities: insert por admin"
  on entities for insert
  with check (is_current_user_admin());

create policy "entities: update por admin"
  on entities for update
  using (is_current_user_admin())
  with check (is_current_user_admin());

create policy "entities: delete por admin"
  on entities for delete
  using (is_current_user_admin());

comment on table entities is
  'Cadastro Nacional de Entidades (catálogo global, não por organização) — pessoas/veículos de imprensa/partidos/instituições/empresas/movimentos relevantes ao debate público monitorado. Cadastro manual e curado (distinto do ranking automático de bw_query_top_authors) — ver .dev/specs/entities/overview.md.';

-- =========================================================================
-- 3. entity_accounts — contas por plataforma, é o que liga uma Entity ao
-- autor equivalente em bw_query_top_authors/bw_query_top_tweeters/mentions
-- (JOIN em tempo de leitura, nunca uma FK — ver author-linking.md).
-- =========================================================================

create table if not exists entity_accounts (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references entities(id) on delete cascade,
  platform      text not null,
  username      text not null,
  url           text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint entity_accounts_unique_handle unique (platform, username)
);

create index if not exists idx_entity_accounts_entity_id on entity_accounts(entity_id);
create index if not exists idx_entity_accounts_platform_username on entity_accounts(platform, lower(username));

create trigger set_updated_at
  before update on entity_accounts
  for each row execute function set_updated_at();

alter table entity_accounts enable row level security;

create policy "entity_accounts: leitura autenticada"
  on entity_accounts for select
  using (auth.role() = 'authenticated');

create policy "entity_accounts: insert por admin"
  on entity_accounts for insert
  with check (is_current_user_admin());

create policy "entity_accounts: update por admin"
  on entity_accounts for update
  using (is_current_user_admin())
  with check (is_current_user_admin());

create policy "entity_accounts: delete por admin"
  on entity_accounts for delete
  using (is_current_user_admin());

comment on table entity_accounts is
  'Contas de uma Entity nas plataformas monitoradas pela Brandwatch (platform+username, sem FK real) — o vínculo com bw_query_top_authors/bw_query_top_tweeters é sempre um JOIN por texto (lower/trim), nunca uma referência de banco. Ver .dev/specs/entities/author-linking.md.';

-- =========================================================================
-- 4. entity_tags — classificação EAV. Uma nova dimensão de classificação é
-- um INSERT, nunca uma migration (mesmo princípio já usado em
-- communication_types/bw_categories.status).
-- =========================================================================

create table if not exists entity_tags (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references entities(id) on delete cascade,
  tag_type      text not null,
  tag_value     text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint entity_tags_unique_dimension_value unique (entity_id, tag_type, tag_value)
);

create index if not exists idx_entity_tags_entity_id on entity_tags(entity_id);
create index if not exists idx_entity_tags_type_value on entity_tags(tag_type, tag_value);

create trigger set_updated_at
  before update on entity_tags
  for each row execute function set_updated_at();

alter table entity_tags enable row level security;

create policy "entity_tags: leitura autenticada"
  on entity_tags for select
  using (auth.role() = 'authenticated');

create policy "entity_tags: insert por admin"
  on entity_tags for insert
  with check (is_current_user_admin());

create policy "entity_tags: update por admin"
  on entity_tags for update
  using (is_current_user_admin())
  with check (is_current_user_admin());

create policy "entity_tags: delete por admin"
  on entity_tags for delete
  using (is_current_user_admin());

comment on table entity_tags is
  'Classificação EAV de uma Entity (partido, espectro político, cargo, estado, poder/instituição etc.) — tag_type/tag_value livres, vocabulário sugerido em .dev/specs/entities/data-model.md, nunca enforçado por constraint.';
