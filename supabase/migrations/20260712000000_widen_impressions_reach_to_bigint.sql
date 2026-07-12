-- Bug de produção: "Erro upsertando bw_query_x_insights (hashtag): value
-- '3962100504' is out of range for type integer" — `impressions` (via
-- data/hashtags) somou mais de 2^31-1 (~2.1 bilhões, teto do `integer` do
-- Postgres). Diferente de contagens de posts (`volume`/`tweets`/
-- `retweets`, limitadas ao número real de mentions/reposts capturados —
-- não passam de milhões mesmo pra um tema nacional), `impressions` e
-- `reach_estimate` são métricas de **visualização/audiência**, cuja escala
-- é ordens de magnitude maior (cada mention pode ter milhões de
-- impressões) e já demonstrou na prática ultrapassar o teto de `integer`.
--
-- Corrige todas as colunas `impressions`/`reach_estimate` já existentes no
-- schema pra `bigint` (teto ~9.2 quintilhões — larga margem), tanto as
-- agregadas (bw_query_*) quanto as por mention individual (`mentions`,
-- onde um único post hiper-viral também pode exceder o teto de `integer`).
-- `total_mentions`/`volume`/`tweets`/`retweets`/`followers`/
-- `monthly_visitors` continuam `integer` — são contagens de itens
-- discretos (posts, seguidores, visitantes), não visualizações, e não têm
-- o mesmo risco de escala.
--
-- `alter column ... type bigint` é sempre seguro (widening, sem perda de
-- dado, sem reescrever linhas em versões recentes do Postgres já que
-- bigint é binário-compatível por cima de integer só quando promovido via
-- USING — aqui não precisa nem de USING explícito, a conversão implícita
-- integer->bigint é direta).

alter table mentions
  alter column reach_estimate type bigint,
  alter column impressions type bigint;

alter table bw_query_metrics_daily
  alter column reach_estimate type bigint;

alter table bw_query_group_metrics_weekly
  alter column reach_estimate type bigint;

alter table bw_query_top_authors
  alter column reach_estimate type bigint,
  alter column impressions type bigint;

alter table bw_query_top_sites
  alter column reach_estimate type bigint;

alter table bw_query_x_insights
  alter column reach_estimate type bigint,
  alter column impressions type bigint;

-- narrative_metrics.reach_estimated é populado direto de
-- bw_query_metrics_daily.reach_estimate (refresh_narrative_metrics()) —
-- precisa acompanhar o widening acima, senão o mesmo overflow acontece
-- aqui assim que uma Narrativa tiver reach agregado acima de ~2.1 bilhões.
alter table narrative_metrics
  alter column reach_estimated type bigint;
