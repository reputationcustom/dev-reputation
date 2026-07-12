-- Gap encontrado ao testar bw-sync: 20260707020000 criou a organização
-- "viabilidade" mas nunca a linha correspondente em brandwatch_credentials
-- — ensureBootstrapSeed() em bw-sync/index.ts depende dela pra resolver
-- organization_id (ver .dev/specs/foundation/brandwatch-setup.md §1).
-- Usuário/senha da Brandwatch já vivem como secrets da Edge Function
-- (BRANDWATCH_USERNAME/PASSWORD/PLATFORM_CLIENT_ID) — esta linha só marca
-- "viabilidade" como a organização dona daquele Client, sem token ainda
-- (access_token_secret_ref/token_expires_at ficam null, preenchidos no
-- primeiro sync bem-sucedido).

insert into brandwatch_credentials (id, organization_id)
select gen_random_uuid(), o.id
from organizations o
where o.name = 'viabilidade'
  and not exists (
    select 1 from brandwatch_credentials bc where bc.organization_id = o.id
  );
