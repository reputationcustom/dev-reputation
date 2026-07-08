-- Bootstrap do primeiro usuário/organização (não é "seed" de dado fake —
-- ver .dev/specs/foundation/overview.md: população de organization_members
-- é manual/SQL direto no MVP, sem tela de convite/criação de organização.
-- Isto é essa população manual, entregue via migration porque o pipeline de
-- deploy deste projeto só aplica supabase/migrations/ ao remoto
-- (supabase/seed.sql só roda em `supabase db reset`, que não é usado aqui).
--
-- ⚠️ Segurança: o hash bcrypt abaixo fica no histórico do git. Não é a senha
-- em texto puro, mas é reversível por força bruta se a senha for fraca —
-- recomendo trocar a senha (via tela de login/reset) assim que o primeiro
-- acesso for confirmado, especialmente se este repositório deixar de ser
-- privado no futuro.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change, email_change_token_new, email_change_token_current
)
select
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  'lidiane.carvalho@gmail.com', crypt('lidi0311', gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}',
  now(), now(), '', '', '', '', ''
where not exists (
  select 1 from auth.users where email = 'lidiane.carvalho@gmail.com'
);

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email = 'lidiane.carvalho@gmail.com'
  and not exists (
    select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
  );

insert into organizations (id, name)
select gen_random_uuid(), 'viabilidade'
where not exists (select 1 from organizations where name = 'viabilidade');

-- Nota: organization_members não tem coluna de papel/role neste MVP (decisão
-- registrada em data-model.md — "trivial de adicionar depois se necessário").
-- O usuário abaixo é o único membro da organização por enquanto, portanto é
-- administrador de fato, mesmo sem um campo `role` explícito no schema.
insert into organization_members (id, organization_id, user_id)
select gen_random_uuid(), o.id, u.id
from organizations o, auth.users u
where o.name = 'viabilidade'
  and u.email = 'lidiane.carvalho@gmail.com'
  and not exists (
    select 1 from organization_members m
    where m.organization_id = o.id and m.user_id = u.id
  );
