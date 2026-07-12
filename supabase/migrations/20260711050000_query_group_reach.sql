-- Validação de spec contra um export real de dashboard Brandwatch
-- (2026-07-11, pedido do usuário): "Reach Over Time" comparando candidatos
-- dentro do mesmo Query Group não tinha equivalente em
-- bw_query_group_metrics_weekly (só total_mentions). Mesmo padrão de
-- dimensão `queries` já usado nesta tabela pro volume
-- (data/volume/queries/weeks?queryGroupId=X), só trocando o agregado pra
-- reachEstimate — ver syncQueryGroupSov() em bw-sync/index.ts.

alter table bw_query_group_metrics_weekly
  add column if not exists reach_estimate integer;
