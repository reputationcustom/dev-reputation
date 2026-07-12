-- Módulo: auth
-- Fonte: .dev/specs/auth/data-model.md
--
-- Cria user_profiles (perfil 1:1 com auth.users, guarda is_admin/is_principal/
-- full_name) e cadastra o admin principal pedido pelo usuário (2026-07-13):
-- lidiane.carvalho@gmail.com, senha 12345, is_admin=true, is_principal=true,
-- protegido contra exclusão/rebaixamento por trigger.
--
-- A conta já existia (bootstrap original, migration 20260707020000, senha
-- 'lidi0311') — esta migration atualiza a senha para o valor pedido e
-- adiciona o perfil de admin principal.
--
-- ⚠️ Segurança: '12345' é uma senha propositalmente fraca pedida para o
-- bootstrap (mesmo padrão de aviso já usado em 20260707020000). O hash
-- bcrypt fica no histórico do git — trocar assim que o primeiro acesso
-- real for confirmado (via .dev/specs/auth/password-recovery.md).

-- =========================================================================
-- 1. Tabela user_profiles
-- =========================================================================

create table if not exists user_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text,
  is_admin     boolean not null default false,
  is_principal boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table user_profiles
  drop constraint if exists user_profiles_principal_implies_admin;

alter table user_profiles
  add constraint user_profiles_principal_implies_admin
  check (not is_principal or is_admin);

create index if not exists user_profiles_is_admin_idx
  on user_profiles(is_admin)
  where is_admin = true;

create trigger set_updated_at
  before update on user_profiles
  for each row execute function set_updated_at();

-- =========================================================================
-- 2. Proteção do admin principal (bloqueia exclusão e rebaixamento, mesmo
--    por chamada direta à Admin API — DELETE em auth.users faz cascade em
--    user_profiles, que dispara este BEFORE DELETE normalmente)
-- =========================================================================

create or replace function protect_principal_account()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.is_principal then
      raise exception 'não é permitido excluir a conta admin principal (%).', OLD.id;
    end if;
    return OLD;
  end if;
  if OLD.is_principal and (NEW.is_admin = false or NEW.is_principal = false) then
    raise exception 'não é permitido remover admin/is_principal da conta principal (%).', OLD.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists protect_principal_account_trigger on user_profiles;

create trigger protect_principal_account_trigger
  before update or delete on user_profiles
  for each row execute function protect_principal_account();

-- =========================================================================
-- 3. Função auxiliar para RLS (mesmo padrão de auth_organization_ids() em
--    foundation/data-model.md — security definer/stable, evita recursão)
-- =========================================================================

create or replace function is_current_user_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_admin from user_profiles where id = auth.uid()),
    false
  )
$$;

-- =========================================================================
-- 4. RLS — só leitura para o client; toda escrita é via Edge Function
--    (SUPABASE_SECRET_KEY, bypassa RLS), ver .dev/specs/auth/user-management.md
-- =========================================================================

alter table user_profiles enable row level security;

drop policy if exists "user_profiles_select_own" on user_profiles;
create policy "user_profiles_select_own"
  on user_profiles for select
  using (id = (select auth.uid()));

drop policy if exists "user_profiles_select_admin" on user_profiles;
create policy "user_profiles_select_admin"
  on user_profiles for select
  using (is_current_user_admin());

-- =========================================================================
-- 5. Seed — admin principal (lidiane.carvalho@gmail.com)
-- =========================================================================

update auth.users
set encrypted_password = crypt('12345', gen_salt('bf')),
    updated_at = now()
where email = 'lidiane.carvalho@gmail.com';

insert into user_profiles (id, full_name, is_admin, is_principal)
select u.id, 'Lidiane Carvalho', true, true
from auth.users u
where u.email = 'lidiane.carvalho@gmail.com'
on conflict (id) do update
  set is_admin = true,
      is_principal = true,
      full_name = coalesce(user_profiles.full_name, excluded.full_name);
