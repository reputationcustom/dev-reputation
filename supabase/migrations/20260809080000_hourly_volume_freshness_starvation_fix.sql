-- Bug real encontrado ao investigar "SOV por pauta ao longo do tempo"
-- continuar vazio mesmo depois de 20260809000000 (grão hour)/20260809020000
-- (loop throttled de volume por Narrativa em `bw_query_metrics_hourly`)
-- terem sido implementados: o widget seguia mostrando 0 pra toda Pauta em
-- todo período "Diário".
--
-- Causa raiz: `runHourlyMetricsStep` (bw-sync/index.ts) chama, nesta ordem,
-- a cada invocação (heartbeat de 1min desde 20260809070000):
--   1. syncHourlySentimentMetrics(categoryId=null) — Query inteira
--   2. syncHourlyNetSentiment(dimension="categories") — 1 linha por
--      Narrativa/hora, mas só grava `net_sentiment` + `synced_at`, NUNCA
--      `total_mentions`
--   3. syncHourlyNetSentiment(dimension="queries")
--   4. loop throttled sobre Narrativas devidas (fetchHourlyVolumeFreshness,
--      via bw_query_metrics_hourly_category_freshness) chamando
--      syncHourlySentimentMetrics(categoryId=X) — a ÚNICA chamada que de
--      fato grava `total_mentions` por Narrativa
--
-- O passo 2 roda incondicionalmente, sem throttle, em TODA invocação, e seu
-- upsert (onConflict project_id,query_id,category_id_key,metric_hour) inclui
-- `synced_at: now()` pra cada linha por-Narrativa que ele toca — mas nunca
-- inclui `total_mentions`. `bw_query_metrics_hourly_category_freshness`
-- (20260809020000) lê `max(synced_at)` por categoria pra decidir quem está
-- "devido" no passo 4 — e como o passo 2 já "tocou" `synced_at` de toda
-- Narrativa nesta mesma invocação, TODA categoria aparece com idade ~0ms no
-- momento em que o passo 4 checa frescor, ficando permanentemente fora do
-- filtro `ageMs >= staleWindowMs`. Resultado: o único passo que grava
-- `total_mentions` por Narrativa nunca chega a rodar — `total_mentions`
-- fica preso no default `0` (`bw_query_metrics_hourly`, 20260713040000) pra
-- sempre, em toda linha com `category_id` preenchido, independente de
-- quantas vezes o pipeline rode. Mesma classe de bug já documentada em
-- CLAUDE.md ("`run_event_detection()` nunca gravava nada" / "`daily_metrics`
-- ainda preso...") — um sinal de frescor sendo tocado por um escritor não
-- relacionado ao dado que ele deveria representar.
--
-- Fix: coluna dedicada `volume_synced_at`, tocada só pelo passo que de fato
-- escreve `total_mentions` (syncHourlySentimentMetrics) — nunca pelo passo
-- de net_sentiment. Uma categoria sem `volume_synced_at` (null) nunca passa
-- a impressão de "recém sincronizada" e continua elegível pro throttle até
-- de fato receber uma chamada de volume real.

alter table bw_query_metrics_hourly
  add column if not exists volume_synced_at timestamptz;

create or replace function bw_query_metrics_hourly_category_freshness(
  p_project_id bigint,
  p_query_id bigint,
  p_category_ids bigint[]
)
returns table (
  category_id bigint,
  latest_synced_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    h.category_id,
    max(h.volume_synced_at) as latest_synced_at
  from bw_query_metrics_hourly h
  where h.project_id = p_project_id
    and h.query_id = p_query_id
    and h.category_id = any(p_category_ids)
  group by h.category_id
$$;

comment on function bw_query_metrics_hourly_category_freshness(bigint, bigint, bigint[]) is
  'Frescor por categoria (MAX(volume_synced_at)) para o throttle de bw-sync (hourly_metrics/volume por Narrativa) — usa volume_synced_at, não synced_at, pra não ser enganado por syncHourlyNetSentiment("categories"), que toca synced_at em toda invocação sem nunca gravar total_mentions (2026-08-09, ver comentário da migration 20260809080000). Agregado no Postgres para nunca ser truncado pelo max_rows do PostgREST, mesmo padrão de bw_query_metrics_daily_category_freshness (20260806010000).';
