-- event-radar 1.5 (schema-integration) item 2 — feed_event_feedback.
-- Implementa .dev/specs/event-radar/data-model.md, "feed_event_feedback" —
-- retroalimentação do analista sobre um card já publicado em feed_events
-- (útil/irrelevante/severidade errada/explicação incorreta), sempre
-- pós-publicação, nunca um gate antes de publicar
-- (schema-integration.md, "Fluxo principal" item 2).
--
-- ⚠️ Escopo desta migration é só o schema/RLS — não há UI nesta sessão
-- pra de fato "dar feedback num card", porque o bloco `highlights` do
-- envelope (`get_active_highlights`, aggregated-metrics) ainda não existe:
-- `feed_events` está sendo populada (1.4), mas nenhuma página do frontend
-- ainda lista/renderiza esses cards. Sem um card na tela, não há onde
-- pendurar um botão de feedback — construir essa UI agora seria antecipar
-- `get_active_highlights`/o bloco `highlights`, que não foi pedido
-- nesta sessão. `schema-integration.md` permanece `rascunho` por causa
-- disso, mesmo com o schema deste item pronto.
--
-- Desenho deliberadamente sem Edge Function — diferente da maioria das
-- escritas deste projeto (que passam por Edge Function mesmo em casos
-- simples), `data-model.md` já especifica este INSERT como direto do
-- cliente, validado inteiramente por RLS/CHECK constraint (Princípio
-- técnico 2 permite validação em Postgres, não só em Edge Function): (a)
-- `feedback_type` restrito pelo CHECK abaixo, (b) `user_id = auth.uid()`
-- garantido pela policy de INSERT, (c) isolamento de organização via
-- subquery no FK pai (`feed_event_id`), mesmo padrão de satélites sem
-- `organization_id` própria (`bw_query_top_authors` etc.). Uma futura UI
-- pode inserir direto via supabase-js, sem precisar de função nova.

create table if not exists feed_event_feedback (
  id              uuid primary key default gen_random_uuid(),
  feed_event_id   uuid not null references feed_events(id) on delete cascade,
  user_id         uuid not null references user_profiles(id),
  feedback_type   text not null,
  comment         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint feed_event_feedback_type_check
    check (feedback_type in ('useful', 'irrelevant', 'wrong_severity', 'wrong_explanation'))
);

create index if not exists idx_feed_event_feedback_feed_event_id on feed_event_feedback(feed_event_id);

create trigger set_updated_at
  before update on feed_event_feedback
  for each row execute function set_updated_at();

alter table feed_event_feedback enable row level security;

-- Leitura escopada por organização via o FK pai (mesmo padrão de
-- satélites sem organization_id própria, ex: bw_query_top_authors) — uma
-- futura tela de "feedback recebido" pode listar sem bypassar RLS.
create policy "feed_event_feedback_select_org"
  on feed_event_feedback for select
  using (
    feed_event_id in (
      select id from feed_events where organization_id in (select auth_organization_ids())
    )
  );

-- Qualquer usuário autenticado da organização pode inserir seu próprio
-- feedback (data-model.md) — nunca em nome de outro usuário, nunca fora
-- da própria organização.
create policy "feed_event_feedback_insert_own"
  on feed_event_feedback for insert
  with check (
    user_id = (select auth.uid())
    and feed_event_id in (
      select id from feed_events where organization_id in (select auth_organization_ids())
    )
  );

-- Sem policy de UPDATE/DELETE — "um feedback é um registro imutável"
-- (data-model.md).
