-- supabase/migrations/20260809210000_avatars_storage_policies_idempotent_fix.sql
--
-- Bug real reportado pelo usuário: upload de avatar em /perfil falhando
-- com 400/403 "new row violates row-level security policy" ao chamar
-- `supabase.storage.from('avatars').upload(...)`, mesmo autenticado e
-- enviando pro path correto (`<user_id>/avatar`). Descartadas as causas
-- do lado do client (revisão do código-fonte de `@supabase/supabase-js`/
-- `@supabase/storage-js` confirma que o SDK anexa o access token da
-- sessão atual em toda chamada de Storage automaticamente, via o mesmo
-- wrapper de fetch usado por `.from()`/`.rpc()` — não há nenhum header
-- de Authorization pré-definido que pudesse mascarar isso) — a causa real
-- só pode estar do lado do banco: ou a migration `20260809200000`
-- (bucket `avatars` + as 3 policies de INSERT/UPDATE/DELETE) nunca
-- terminou de aplicar no projeto Supabase real, ou o bucket foi criado
-- por fora (ex: manualmente pelo Dashboard, testando antes do deploy)
-- sem as policies correspondentes — nos dois casos, o sintoma observado
-- é idêntico: o bucket existe (por isso não é um 404 "Bucket not found"),
-- mas nenhuma policy de INSERT casa pro usuário autenticado.
--
-- Corrigido tornando a garantia idempotente — `on conflict do update` no
-- bucket e `drop policy if exists` antes de cada `create policy` — para
-- que rodar esta migration sempre deixe o estado final correto,
-- independentemente de qual dos dois cenários acima é o real (e sem
-- editar a migration já aplicada, CLAUDE.md "Migration hygiene": nunca
-- assumir que uma migration anterior "já tratou isso" sem checar o
-- estado real).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars: usuário gerencia a própria pasta (insert)" on storage.objects;
drop policy if exists "avatars: usuário gerencia a própria pasta (update)" on storage.objects;
drop policy if exists "avatars: usuário gerencia a própria pasta (delete)" on storage.objects;

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
