-- Organização padrão do usuário — CLAUDE.md, "Permitir o usuário a escolher
-- qual organização é a default" (pedido do usuário, 2026-07-22). Mesmo
-- padrão de auto-atualização já usado por `timezone`
-- (20260713060000_user_profiles_timezone.sql): sem policy de UPDATE para o
-- client, a escrita passa por uma Edge Function dedicada
-- (`update-my-default-organization`, SUPABASE_SECRET_KEY, bypassa RLS) que
-- valida server-side que o usuário é membro da organização antes de gravar
-- (Princípio 2 — sem lógica de negócio no frontend).
--
-- Nullable (diferente de `timezone`, que tem um default sensato): o usuário
-- pode nunca ter escolhido uma organização padrão, e nesse caso o frontend
-- continua caindo de volta pra primeira organização retornada (mesmo
-- comportamento de antes desta migration, ver header-context.tsx).
-- `on delete set null`: se a organização em si for excluída, o usuário só
-- perde a preferência, nunca fica com uma referência quebrada.

alter table user_profiles
  add column if not exists default_organization_id uuid references organizations(id) on delete set null;

comment on column user_profiles.default_organization_id is
  'Organização que o usuário escolheu como padrão (definida via update-my-default-organization). Nula até a primeira escolha explícita; o frontend cai de volta para a primeira organização do usuário quando nula.';
