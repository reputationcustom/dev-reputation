-- "Atualizar resumo executivo" (NarrativeTextPanel, ai-synthesis Camada 2)
-- ficava visível pra todo admin em qualquer período — pedido do usuário
-- (2026-07-14, sessão seguinte à que introduziu o botão): em apresentação
-- do produto o ideal é o botão não aparecer, mas em desenvolvimento/testes
-- é importante poder forçar uma recomposição manual. Em vez de uma
-- flag global (afetaria todo admin da organização de uma vez, mesmo que só
-- um esteja testando), uma preferência pessoal do próprio usuário admin —
-- mesmo padrão de auto-atualização já usado por `timezone`
-- (20260713060000) e `default_organization_id` (20260722000000): sem
-- policy de UPDATE para o client, a escrita passa por uma Edge Function
-- dedicada (`update-my-refresh-button-preference`, SUPABASE_SECRET_KEY,
-- bypassa RLS).
--
-- Default `false` ("o ideal é não aparecer") — o botão só some por padrão,
-- nunca aparece por padrão; quem quiser vê-lo em teste/desenvolvimento
-- marca a preferência explicitamente em /perfil. Não nullable (diferente
-- de `default_organization_id`): sempre tem um valor real, "mostrar" ou
-- "não mostrar", nunca "ainda não decidido".

alter table user_profiles
  add column if not exists show_ai_refresh_button boolean not null default false;

comment on column user_profiles.show_ai_refresh_button is
  'Preferência pessoal do usuário admin: mostrar o botão "Atualizar resumo executivo" (ai-synthesis Camada 2) fora do período personalizado. Default false — some em apresentações do produto por padrão, ligado explicitamente via update-my-refresh-button-preference para desenvolvimento/testes.';
