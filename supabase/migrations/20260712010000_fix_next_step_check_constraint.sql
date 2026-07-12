-- Bug de produção: "Erro atualizando sync_cursors: new row for relation
-- \"sync_cursors\" violates check constraint \"sync_cursors_next_step_check\"".
--
-- Causa: `platform_by_narrative` foi adicionado a `SYNC_STEPS` em
-- bw-sync/index.ts (migration 20260711090000, "SOV por plataforma") mas a
-- migration correspondente só criou a tabela/coluna nova
-- (bw_query_metrics_daily_by_platform.category_id) — esqueceu de
-- atualizar `sync_cursors_next_step_check` (que ainda tinha só os 11
-- valores da migration anterior, 20260711070000) pra incluir o 12º valor.
-- Assim que o ciclo de fases chegava em `platform_by_narrative`, o UPDATE
-- de `sync_cursors.next_step` violava a constraint.

alter table sync_cursors drop constraint if exists sync_cursors_next_step_check;
alter table sync_cursors
  add constraint sync_cursors_next_step_check
  check (next_step in (
    'metadata', 'mentions', 'daily_metrics', 'weekly_monthly', 'topics',
    'platform_by_narrative', 'x_insights', 'top_authors',
    'author_enrichment', 'top_sites', 'demographics', 'sov'
  ));
