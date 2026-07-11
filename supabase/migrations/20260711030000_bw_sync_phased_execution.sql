-- Pedido do usuário (2026-07-11): "vamos ter que melhorar a arquitetura
-- dessa edge function" — bw-sync crashou em produção com "CPU Time
-- exceeded". Uma única invocação, ao processar um par (project_id,
-- query_id) "devido", encadeava mentions (paginado) + sentimento diário
-- (5 chamadas) + reach/engagement por Category (2 chamadas, uma delas
-- devolvendo 4825 linhas numa resposta só) + plataforma + (quando
-- "stale") semanal/mensal + temas + top authors (até 1000 linhas ×
-- categoryTarget) + SOV — dezenas de milhares de objetos JSON
-- processados sincronamente numa só invocação, estourando o orçamento de
-- CPU do runtime (diferente do limite de memória/WORKER_RESOURCE_LIMIT já
-- corrigido antes — CPU time é computação síncrona, não espera de rede).
--
-- Correção: quebrar o trabalho de um par em fases (`sync_cursors.next_step`),
-- uma por invocação. Cada heartbeat de 15min (ou clique manual no
-- Dashboard — o estado vive no Postgres, não em memória, então qualquer
-- invocação continua de onde a anterior parou) processa só a fase atual e
-- avança pra próxima. O ciclo completo (metadata → mentions →
-- daily_metrics → weekly_monthly → topics → top_authors → sov) só fecha
-- (e rearma o gate de BW_SYNC_INTERVAL_HOURS via last_synced_at) quando a
-- última fase roda. Ver supabase/functions/bw-sync/index.ts e
-- .dev/specs/foundation/sync-brandwatch.md.

alter table sync_cursors
  add column if not exists next_step text not null default 'metadata';

alter table sync_cursors
  add constraint sync_cursors_next_step_check
  check (next_step in (
    'metadata', 'mentions', 'daily_metrics', 'weekly_monthly', 'topics', 'top_authors', 'sov'
  ));
