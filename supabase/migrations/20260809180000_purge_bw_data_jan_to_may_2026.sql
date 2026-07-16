-- Expurga dado sincronizado da Brandwatch referente a janeiro/26–maio/26
-- (2026-01-01 até 2026-05-31, inclusive) de toda tabela `bw_*` com coluna
-- de período de negócio, mais `mentions` (menções brutas, particionada por
-- mês via mention_date — pedido explícito do usuário, DELETE linha a linha,
-- não DROP das partitions).
--
-- Escopo decidido com o usuário (2026-07-16):
--   - Incluído: toda tabela `bw_*` com metric_date/metric_week/metric_month/
--     metric_hour, mais `mentions` (mention_date).
--   - Excluído deliberadamente: `narrative_metrics` (metric_date, derivada
--     de bw_query_metrics_daily) — usuário optou por não incluir, mesmo
--     sabendo que ficará com métricas de jan-mai/26 calculadas em cima de
--     bw_query_metrics_daily que não existirá mais para esse período.
--   - Excluído: `bw_projects`/`bw_queries`/`bw_query_groups`/`bw_categories`/
--     `bw_sync_lock` (sem coluna de período de negócio — metadados/lock) e
--     `radar_staging_events`/`feed_events` (dado derivado de detecção, não
--     dado bruto sincronizado da Brandwatch).
--
-- Limite superior exclusivo (`< 2026-06-01`) em vez de `<= 2026-05-31` para
-- cobrir corretamente bw_query_metrics_hourly.metric_hour (timestamptz,
-- não date) sem depender de truncamento de hora.

delete from bw_query_metrics_daily
  where metric_date >= '2026-01-01' and metric_date < '2026-06-01';

delete from bw_query_metrics_weekly
  where metric_week >= '2026-01-01' and metric_week < '2026-06-01';

delete from bw_query_metrics_monthly
  where metric_month >= '2026-01-01' and metric_month < '2026-06-01';

delete from bw_query_group_metrics_weekly
  where metric_week >= '2026-01-01' and metric_week < '2026-06-01';

delete from bw_query_metrics_daily_by_platform
  where metric_date >= '2026-01-01' and metric_date < '2026-06-01';

delete from bw_query_topics
  where metric_week >= '2026-01-01' and metric_week < '2026-06-01';

delete from bw_query_top_authors
  where metric_week >= '2026-01-01' and metric_week < '2026-06-01';

delete from bw_query_author_topics
  where metric_week >= '2026-01-01' and metric_week < '2026-06-01';

delete from bw_query_top_sites
  where metric_week >= '2026-01-01' and metric_week < '2026-06-01';

delete from bw_query_x_insights
  where metric_week >= '2026-01-01' and metric_week < '2026-06-01';

delete from bw_query_demographics_daily
  where metric_date >= '2026-01-01' and metric_date < '2026-06-01';

delete from bw_query_top_tweeters
  where metric_week >= '2026-01-01' and metric_week < '2026-06-01';

delete from bw_query_top_shared_sites
  where metric_week >= '2026-01-01' and metric_week < '2026-06-01';

delete from bw_query_metrics_hourly
  where metric_hour >= '2026-01-01T00:00:00Z' and metric_hour < '2026-06-01T00:00:00Z';

-- mentions é particionada por mês (mentions_2026_01..2026_05 cobrem
-- integralmente este range) — DELETE linha a linha por decisão explícita do
-- usuário (não DROP das partitions), o Postgres faz partition pruning
-- automaticamente sobre o filtro de mention_date.
delete from mentions
  where mention_date >= '2026-01-01' and mention_date < '2026-06-01';
