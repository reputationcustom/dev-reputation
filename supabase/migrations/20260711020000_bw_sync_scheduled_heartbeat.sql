-- Pedido do usuário (2026-07-11): "a cada 3 horas as rotinas de integração
-- com a Brandwatch sejam executadas para capturar o cenário atual" — e que
-- esse parâmetro seja configurável e fácil de alterar via variável de
-- ambiente. bw-sync nunca teve pg_cron agendado até aqui — só invocação
-- manual (ver CLAUDE.md "Brandwatch sync model").
--
-- O bloqueio documentado até agora ("mint de token gastando parte do
-- orçamento de 30 chamadas/10min a cada invocação, antes de agendar via
-- pg_cron de verdade") só importava numa cadência de ~20-30s entre
-- invocações. Numa cadência de horas, mintar 1 token por par sincronizado
-- é irrelevante para o rate limit — o bloqueio deixa de existir com esse
-- desenho, sem precisar implementar o cache de token no Vault antes (isso
-- continua um TODO separado, só que não é mais pré-requisito).
--
-- Desenho (ver supabase/functions/bw-sync/index.ts e
-- .dev/specs/foundation/sync-brandwatch.md, passo 0.5b):
--   - pg_cron dispara um "heartbeat" barato a cada 15 minutos (cadência
--     fixa — decisão de infraestrutura, não é o parâmetro de negócio que o
--     usuário pediu para ser configurável; só precisa ser frequente o
--     bastante relativo ao intervalo de negócio para não gerar atraso
--     perceptível).
--   - A cada heartbeat, bw-sync decide se algum par (project_id, query_id)
--     está "devido": sync_cursors.last_synced_at mais antigo que
--     BW_SYNC_INTERVAL_HOURS (secret da própria Edge Function, default 3).
--     Se nenhum par estiver devido, a função sai imediatamente sem mintar
--     token nem chamar a Brandwatch.
--   - Trocar BW_SYNC_INTERVAL_HOURS (supabase secrets set) muda o
--     comportamento na invocação seguinte, sem precisar de nova migration
--     — é isso que satisfaz "configurável e fácil de alterar em variável
--     de ambiente". O heartbeat de 15min em si só muda via nova migration
--     (cron.alter_job) — não precisa ser mais dinâmico que isso.
--
-- bw-sync roda com verify_jwt = false (supabase/config.toml — função só
-- acionada por pg_cron/manualmente, nunca pelo frontend), então o
-- net.http_post abaixo não precisa de Authorization header nenhum.
--
-- ⚠️ URL da function hardcoded abaixo (não é segredo — é o mesmo valor já
-- exposto a qualquer client via NEXT_PUBLIC_SUPABASE_URL no frontend;
-- Princípio técnico 1 é sobre credenciais — chave secreta, tokens
-- Brandwatch — não sobre o identificador público do projeto). Projeto tem
-- um único alvo de deploy (ver CLAUDE.md — GitHub Action sincroniza pra um
-- único projeto Supabase remoto), então não há ambiguidade de qual URL
-- usar. Se o projeto Supabase for recriado/migrado no futuro, uma nova
-- migration troca a URL via `select cron.alter_job(job_id, command => ...)`
-- (ou unschedule + schedule de novo).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'bw-sync-heartbeat',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://ktvyqpogfnowuqmjybvu.supabase.co/functions/v1/bw-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
