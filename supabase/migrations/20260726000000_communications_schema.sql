-- Módulo `communications` (Sprint 2.1) — .dev/specs/communications/data-model.md
--
-- Registro de Comunicações (post, e-mail, propaganda de TV etc.) e Decisões
-- (data/título/responsável/detalhamento) vinculadas a uma Narrativa, com
-- CRUD completo pela UI desde o início — diferente de `cases`, que
-- permanece somente leitura. Ver overview.md, "Relação com `cases`", para a
-- distinção completa.

-- =========================================================================
-- 1. communication_types — tabela de referência, não enum (pedido do
-- usuário: "tipo de comunicação pode ser uma tabela que é atualizada com os
-- tipos e a lógica do módulo pega dela"). Mesmo padrão de extensibilidade
-- já usado em bw_categories.status/entity_tags — adicionar um tipo novo é
-- um INSERT, nunca uma migration.
-- =========================================================================

create table if not exists communication_types (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  label         text not null,
  is_active     boolean not null default true,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger set_updated_at
  before update on communication_types
  for each row execute function set_updated_at();

insert into communication_types (code, label, position) values
  ('social_post', 'Post em rede social', 10),
  ('email', 'E-mail', 20),
  ('tv_ad', 'Propaganda de TV', 30),
  ('radio_ad', 'Propaganda de rádio', 40),
  ('press_release', 'Assessoria de imprensa/nota oficial', 50),
  ('printed_material', 'Material impresso (panfleto, outdoor)', 60),
  ('event', 'Evento presencial', 70),
  ('other', 'Outro', 999)
on conflict (code) do nothing;

alter table communication_types enable row level security;

-- Tabela global (não escopada por organization_id) — mesma taxonomia
-- compartilhada por toda a plataforma, papel equivalente a um enum.
create policy "communication_types: leitura autenticada"
  on communication_types for select
  using (auth.role() = 'authenticated');

-- Sem policy de INSERT/UPDATE/DELETE de propósito — deny-all pra qualquer
-- client (RLS ativa, zero policy de escrita). Sem UI de gestão de tipos
-- ainda; populado/editado via SQL direto ou uma futura tela `is_admin`-only.

-- =========================================================================
-- 2. communication_record_type — estrutural, só 2 valores, não se espera
-- que cresça (diferente de communication_types acima) — enum apropriado.
-- =========================================================================

create type communication_record_type as enum ('communication', 'decision');

-- =========================================================================
-- 3. communications
-- =========================================================================

create table if not exists communications (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references organizations(id) on delete cascade,
  narrative_id            uuid not null references narratives(id) on delete cascade,
  record_type             communication_record_type not null,
  communication_type_id   uuid references communication_types(id),
  title                   text not null,
  description             text,
  channel_detail          text,
  external_url            text,
  bw_resource_id          text,
  occurred_at             timestamptz not null,
  assignee_id             uuid references user_profiles(id),
  created_by              uuid references user_profiles(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint communications_record_type_fields_check check (
    (record_type = 'communication' and communication_type_id is not null)
    or
    (record_type = 'decision'
      and communication_type_id is null
      and channel_detail is null
      and external_url is null
      and bw_resource_id is null)
  )
);

create index if not exists idx_communications_narrative_id_occurred_at on communications(narrative_id, occurred_at);
create index if not exists idx_communications_organization_id on communications(organization_id);
create index if not exists idx_communications_occurred_at on communications(occurred_at);
create index if not exists idx_communications_communication_type_id on communications(communication_type_id);
create index if not exists idx_communications_record_type on communications(record_type);

create trigger set_updated_at
  before update on communications
  for each row execute function set_updated_at();

-- Deriva organization_id a partir de narrative_id, ignorando qualquer valor
-- enviado pelo client — nunca confiar em organization_id vindo do client
-- (Princípio técnico 2). security definer pra poder ler `narratives`
-- independente da role/RLS de quem está inserindo.
create or replace function set_communication_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select organization_id into new.organization_id
  from narratives
  where id = new.narrative_id;

  if new.organization_id is null then
    raise exception 'narrative_id inválido ou sem organização associada';
  end if;

  return new;
end;
$$;

create trigger communications_set_organization
  before insert on communications
  for each row
  execute function set_communication_organization();

alter table communications enable row level security;

create policy "communications: select por organização"
  on communications for select
  using (organization_id in (select auth_organization_ids()));

-- Sem restrição por papel/criador nesta versão (decisão do usuário,
-- 2026-07-25: "Permissão de CRUD de communications sem restrição por
-- enquanto, versões mais adiante será restrito por perfis") — qualquer
-- membro da organização pode registrar/editar/excluir qualquer
-- Comunicação/Decisão de qualquer colega.
create policy "communications: insert por organização"
  on communications for insert
  with check (organization_id in (select auth_organization_ids()));

create policy "communications: update por organização"
  on communications for update
  using (organization_id in (select auth_organization_ids()))
  with check (organization_id in (select auth_organization_ids()));

create policy "communications: delete por organização"
  on communications for delete
  using (organization_id in (select auth_organization_ids()));

comment on table communications is
  'Comunicações e Decisões vinculadas a uma Narrativa (Sprint 2.1, .dev/specs/communications/). record_type discrimina os dois tipos — Decisão é um subconjunto estrito dos campos de Comunicação, garantido pelo CHECK constraint. Não confundir com `cases` (intelligence-center) — ver communications/overview.md, "Relação com cases".';
