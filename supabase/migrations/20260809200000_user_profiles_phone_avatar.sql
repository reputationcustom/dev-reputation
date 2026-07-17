-- supabase/migrations/20260809200000_user_profiles_phone_avatar.sql
--
-- Redesign de /perfil (CLAUDE.md, sessão do pedido): o usuário quer poder
-- editar avatar/nome/telefone além do fuso horário já existente. `phone`/
-- `avatar_url` são as duas colunas novas em `user_profiles` — mesma
-- disciplina de toda coluna nova nesta tabela (nullable, sem default
-- forçado, editável só via Edge Function self-service, nunca direto pelo
-- client — CLAUDE.md, "Nenhuma policy de INSERT/UPDATE/DELETE para o
-- client é proposital").
--
-- `avatar_url` guarda a URL pública do arquivo já enviado ao bucket
-- `avatars` (abaixo) — nunca o binário em si, mesmo padrão já usado por
-- `entities.photo_url` (URL, não upload) só que aqui com upload de
-- verdade, já que é a primeira vez que este projeto precisa de um bucket
-- de Storage (CLAUDE.md, "Database security (Security Advisor)", regra 4:
-- "Nenhum Storage bucket existe neste projeto ainda — aplicar isso na
-- primeira vez que um for adicionado").
alter table public.user_profiles
  add column if not exists phone text,
  add column if not exists avatar_url text;

-- Bucket público — serve avatar por URL direta via getPublicUrl(), sem
-- nenhuma policy de SELECT (CLAUDE.md, regra 4: uma policy de SELECT
-- ampla só habilitaria listagem via API, que ninguém precisa aqui; o
-- bucket já serve o arquivo por URL sem depender de RLS).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Cada usuário só pode gerenciar arquivos dentro da própria pasta
-- (avatars/<user_id>/<arquivo>) — nunca escrever/substituir/apagar o
-- avatar de outro usuário. `storage.foldername(name)` devolve o array de
-- segmentos do path antes do nome do arquivo; o primeiro segmento precisa
-- bater com o próprio `auth.uid()`.
create policy "avatars: usuário gerencia a própria pasta (insert)"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "avatars: usuário gerencia a própria pasta (update)"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "avatars: usuário gerencia a própria pasta (delete)"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
