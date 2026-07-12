-- Correção (2026-07-07, ver .dev/specs/foundation/brandwatch-setup.md §1):
-- access_token_secret_ref deixa de ser preenchido manualmente no cadastro da
-- credencial e vira um cache do token que a Edge Function bw-sync minta em
-- runtime (grant_type=api-password, usando BRANDWATCH_USERNAME/
-- BRANDWATCH_PASSWORD/BRANDWATCH_PLATFORM_CLIENT_ID como secrets da própria
-- Edge Function). Uma linha em brandwatch_credentials agora pode existir só
-- com organization_id/bw_client_id, sem token, até a primeira execução do
-- sync popular o cache — por isso a coluna precisa aceitar null.

alter table brandwatch_credentials
  alter column access_token_secret_ref drop not null;
