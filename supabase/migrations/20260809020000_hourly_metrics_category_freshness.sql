-- Suporte SQL pro fix de bw-sync/index.ts (2026-08-09, mesma sessão):
-- `runHourlyMetricsStep` ganhou um loop throttled de volume horário por
-- Narrativa (round-robin por staleness, mesmo padrão de
-- `fetchDailySentimentFreshness`/`bw_query_metrics_daily_category_freshness`,
-- migration `20260806010000`) — precisa de uma função equivalente pra
-- `bw_query_metrics_hourly`.
--
-- Mesmo cuidado do fix original de 2026-08-06: nunca uma `select` bruta
-- (`... where category_id in (...)`, sem `order by`/`limit`) pra calcular
-- MAX(synced_at) por categoria no client — com múltiplas categorias numa
-- janela de 30 dias × 24h (`bw_query_metrics_hourly`, migration
-- `20260713040000`), o total de linhas pode passar de `max_rows = 1000`
-- (`supabase/config.toml`) rápido o bastante pra arriscar o mesmo corte
-- silencioso sem garantia de quais linhas sobrevivem. Agregação feita no
-- Postgres via `GROUP BY` devolve no máximo `p_category_ids.length` linhas,
-- nunca sujeita a esse corte.

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
    max(h.synced_at) as latest_synced_at
  from bw_query_metrics_hourly h
  where h.project_id = p_project_id
    and h.query_id = p_query_id
    and h.category_id = any(p_category_ids)
  group by h.category_id
$$;

comment on function bw_query_metrics_hourly_category_freshness(bigint, bigint, bigint[]) is
  'Frescor por categoria (MAX(synced_at)) para o throttle de bw-sync (hourly_metrics/volume por Narrativa) — agregado no Postgres para nunca ser truncado pelo max_rows do PostgREST, mesmo padrão de bw_query_metrics_daily_category_freshness (20260806010000).';
