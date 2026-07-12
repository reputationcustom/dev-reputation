-- Módulo: auth
-- Bug real reportado pelo usuário (2026-07-16): 406 ao abrir /perfil.
--
-- Causa raiz: user_profiles só ganhava uma linha via insert manual em
-- admin-invite-user/index.ts — qualquer conta criada por outro caminho (ex:
-- direto pelo Dashboard do Supabase, usada para testes) fica sem linha
-- correspondente. hooks/use-user-profile.ts faz `.select(...).single()` sem
-- filtro explícito (RLS já escopa para o próprio usuário via
-- user_profiles_select_own) — com 0 linhas, o PostgREST responde 406 em vez
-- de simplesmente "sem dado", que é o que single() força via
-- Accept: application/vnd.pgrst.object+json.
--
-- Fecha a lacuna na raiz, não só no ponto onde foi observada: todo INSERT em
-- auth.users passa a garantir uma linha em user_profiles via trigger,
-- qualquer que seja o caminho de criação da conta. O insert manual em
-- admin-invite-user continua existindo (preenche full_name/is_admin no mesmo
-- passo) — "on conflict do nothing" evita erro de duplicidade entre os dois.

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into user_profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- Backfill: contas que já existiam em auth.users sem user_profiles.
insert into user_profiles (id)
select u.id
from auth.users u
left join user_profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;
