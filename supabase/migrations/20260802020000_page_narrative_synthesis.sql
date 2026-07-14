-- aggregated-metrics/ai-synthesis.md, "Camada 1" (event-radar/
-- fluxo-aggregated-metrics.md "Fase B", A3) — armazenamento persistente da
-- composição em lote de narrative_text. Ver "Dados envolvidos" da spec
-- pro schema completo; este arquivo implementa exatamente o que está lá.

create table if not exists page_narrative_synthesis (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  page           text not null,
  period_start   date not null,
  period_end     date not null,
  filters_hash   text not null,
  narrative_text text not null,
  layer          text not null check (layer in ('layer_1', 'layer_2')),
  -- true quando period_end < hoje (America/Sao_Paulo) no momento da
  -- geração — período fechado, nunca mais regenerado pra esta chave (ver
  -- ai-synthesis.md, "Fluxo principal" passo 3).
  is_final       boolean not null,
  generated_at   timestamptz not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists idx_page_narrative_synthesis_key
  on page_narrative_synthesis (organization_id, page, period_start, period_end, filters_hash);

create trigger set_updated_at
  before update on page_narrative_synthesis
  for each row execute function set_updated_at();

-- RLS: mesmo padrão de organization_id in auth_organization_ids() já usado
-- em foundation/communications. A Edge Function que lê/escreve esta
-- tabela (get-page-*, ver aggregated-metrics-service.ts) usa o client
-- autenticado com o JWT do usuário, nunca a chave secreta (mesma nota já
-- registrada em edge-functions-per-page.md, "Autenticação do client
-- Supabase") — por isso, diferente de feed_events/radar_staging_events
-- (só SUPABASE_SECRET_KEY escreve), esta tabela precisa de policy de
-- INSERT/UPDATE pra authenticated também, não só SELECT.
alter table page_narrative_synthesis enable row level security;

create policy "page_narrative_synthesis_select_org"
  on page_narrative_synthesis for select
  using (organization_id in (select auth_organization_ids()));

create policy "page_narrative_synthesis_insert_org"
  on page_narrative_synthesis for insert
  with check (organization_id in (select auth_organization_ids()));

create policy "page_narrative_synthesis_update_org"
  on page_narrative_synthesis for update
  using (organization_id in (select auth_organization_ids()))
  with check (organization_id in (select auth_organization_ids()));
