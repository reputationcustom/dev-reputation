-- Gap #21 de _pending.md, resolvido nesta sessão (decisão do usuário:
-- "Cache de página (TTL 5min)" — implementar agora). edge-functions-per-page.md
-- já previa isso desde a spec original ("Cache: TTL padrão de 5 minutos
-- por combinação de (organization_id, page, period, filters)") — nunca
-- tinha sido implementado, as 6 Edge Functions recalculavam o envelope a
-- cada chamada.
--
-- Escopo desta rodada: só o TTL de 5 minutos. Invalidação antecipada por
-- "sync da Brandwatch concluiu um ciclo" ou "usuário clicou 'Atualizar
-- dados'" NÃO está implementada — nenhum dos dois gatilhos existe hoje no
-- produto (bw-sync não sabe desta tabela; não existe botão "Atualizar
-- dados" no header do frontend ainda). Documentado como gap remanescente
-- em _pending.md em vez de fingir estar completo.
--
-- Escrito pelo mesmo client autenticado com JWT do usuário que as 6 Edge
-- Functions get-page-*/get-narrative-detail já usam (nunca
-- SUPABASE_SECRET_KEY, ver edge-functions-per-page.md "Autenticação do
-- client Supabase") — por isso as policies de INSERT/UPDATE, não só
-- SELECT, precisam existir e usar a mesma checagem de auth_organization_ids().

create table if not exists page_cache (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  page           text not null,
  period_start   date not null,
  period_end     date not null,
  filters_hash   text not null,
  envelope       jsonb not null,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint page_cache_key unique (organization_id, page, period_start, period_end, filters_hash)
);

create trigger set_updated_at
  before update on page_cache
  for each row execute function set_updated_at();

alter table page_cache enable row level security;

create policy "page_cache: select own org" on page_cache
  for select
  using (organization_id in (select auth_organization_ids()));

create policy "page_cache: insert own org" on page_cache
  for insert
  with check (organization_id in (select auth_organization_ids()));

create policy "page_cache: update own org" on page_cache
  for update
  using (organization_id in (select auth_organization_ids()))
  with check (organization_id in (select auth_organization_ids()));

comment on table page_cache is
  'Cache de resposta das 6 Edge Functions get-page-*/get-narrative-detail (edge-functions-per-page.md). TTL 5min via expires_at, checado pela Edge Function (não um job de limpeza) — linhas expiradas ficam na tabela até serem sobrescritas pela mesma chave (upsert), sem retenção/pruning job. Escrito com o client autenticado do usuário (JWT), nunca SUPABASE_SECRET_KEY.';
