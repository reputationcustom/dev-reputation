-- Módulo: auth
-- Fonte: pedido do usuário (2026-07-13) — regra global de fuso horário do
-- usuário (ver CLAUDE.md, "Fuso horário do usuário").
--
-- Adiciona user_profiles.timezone (nome IANA, ex: 'America/Sao_Paulo').
-- Toda data no produto continua armazenada em UTC (timestamptz) — este
-- campo só controla como o frontend formata/exibe essas datas, nunca como
-- são guardadas (nenhuma tabela passa a armazenar hora local).
--
-- Sem policy de UPDATE para o client: mesma decisão já documentada em
-- auth/data-model.md ("toda escrita em user_profiles é decisão
-- administrativa/via Edge Function") — a exceção de auto-atualização do
-- próprio fuso (não é uma ação "administrativa") passa pela Edge Function
-- update-my-timezone (SUPABASE_SECRET_KEY, bypassa RLS), não por uma
-- policy nova.

alter table user_profiles
  add column if not exists timezone text not null default 'America/Sao_Paulo';

comment on column user_profiles.timezone is
  'Nome IANA (ex: America/Sao_Paulo) usado pelo frontend para formatar datas UTC armazenadas no banco. Nunca usado para armazenar hora local.';
