-- .dev/specs/sync-console/data-model.md — histórico completo de execuções
-- do pipeline bw-sync + "quantos registros foram sincronizados em cada
-- etapa". sync_log já grava uma linha por fase executada (ver
-- bw-sync/index.ts, dispatcher), mas não registrava qual fase foi, quanto
-- tempo levou, se foi automática ou manual — insuficiente pra tela de
-- histórico do módulo sync-console. rows_processed (coluna já existente)
-- só refletia a fase `mentions` até esta sessão; bw-sync/index.ts foi
-- ajustado na mesma sessão pra popular um valor real em toda fase (ver
-- `recordsSyncedThisStep` no código) — esta migration só adiciona o
-- schema, a mudança de comportamento já está no código.

alter table sync_log
  add column if not exists step text,
  add column if not exists duration_ms integer,
  add column if not exists stop_reason text,
  add column if not exists trigger_source text not null default 'cron',
  add column if not exists triggered_by_user_id uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sync_log_trigger_source_check'
  ) then
    alter table sync_log
      add constraint sync_log_trigger_source_check
      check (trigger_source in ('cron', 'manual'));
  end if;
end $$;

-- Suporte à consulta paginada por par (get-sync-console-history com
-- projectId/queryId informados) — mesma cautela já documentada várias
-- vezes neste projeto (CLAUDE.md, "Migration hygiene"): sync_log acumula
-- indefinidamente (sem job de retenção/poda), então uma consulta sem um
-- índice cujo primeiro campo bata com o filtro real degrada
-- silenciosamente conforme a tabela cresce (mesma classe de bug já
-- corrigida em bw_query_metrics_daily* e no statement timeout do
-- event-radar). A consulta "todos os pares combinados" (sem filtro)
-- já é servida pelo índice idx_sync_log_created_at existente desde
-- `foundation` — nenhum índice novo necessário para esse caso.
create index if not exists sync_log_project_query_created_idx
  on sync_log (project_id, query_id, created_at desc);
