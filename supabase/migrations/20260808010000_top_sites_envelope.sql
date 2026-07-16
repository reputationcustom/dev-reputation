-- Bloco `top_sites` do envelope — .dev/specs/intelligence-center/
-- authors-and-influencers.md, redesenho em 2 guias (Visão Geral: "Top
-- Autores, Top Sites, Top Stories").
--
-- Gap real fechado: `bw_query_top_sites` (migration `20260711060000`,
-- "Top Sites" — data/volume/topsites/queries, domínios de onde as menções
-- se originam, distinto de `bw_query_top_shared_sites` = "Top Shared
-- Sites", domínios linkados/compartilhados DENTRO do conteúdo das
-- menções) já é sincronizada por `bw-sync` (`runTopSitesStep`,
-- `isTopSitesStale`, throttle semanal, mesmo padrão de `bw_query_x_insights`)
-- desde 2026-07-11, mas nunca tinha nenhuma function SQL/bloco de envelope
-- lendo essa tabela — dado 100% sincronizado e 100% inacessível ao
-- frontend até agora. `bw_query_top_shared_sites` continua de fora desta
-- migration (só "Top Sites" foi pedido nesta sessão) — mesmo gap, não
-- fechado, documentado para uma sessão futura se for pedido.
--
-- Mesmo padrão exato de `get_x_insights` (`20260803010000`): escopo por
-- Narrativa via `filter_category_ids`/`cat_ids` (cross join, nunca
-- `= any((select ...))` — regra de `CLAUDE.md`), "latest" agrupado por
-- `category_id` (nunca um `max(metric_week)` global, mesmo bug já
-- corrigido em `get_x_insights` — aqui já nasce correto), top 15 por
-- `volume` (um pouco mais que os 10 de X Insights — "Top Sites" é
-- tradicionalmente uma lista mais longa no próprio dashboard nativo da
-- Brandwatch).

create or replace function get_top_sites(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  domain text,
  volume integer,
  reach_estimate integer,
  monthly_visitors integer,
  sentiment_positive integer,
  sentiment_neutral integer,
  sentiment_negative integer,
  synced_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with cat_ids as (
    select filter_category_ids(p_organization_id, p_filters) as ids
  ),
  scoped as (
    select ts.*
    from bw_query_top_sites ts
    cross join cat_ids
    where ts.query_id in (select org_query_ids(p_organization_id))
      and (
        (cat_ids.ids is null and ts.category_id is null)
        or ts.category_id = any(cat_ids.ids)
      )
  ),
  latest as (
    select category_id, max(metric_week) as w
    from scoped
    group by category_id
  ),
  ranked as (
    select
      s.domain,
      s.volume,
      s.reach_estimate,
      s.monthly_visitors,
      s.sentiment_positive,
      s.sentiment_neutral,
      s.sentiment_negative,
      s.synced_at,
      row_number() over (partition by s.category_id order by s.volume desc) as rn
    from scoped s
    join latest l
      on l.category_id is not distinct from s.category_id
      and l.w = s.metric_week
  )
  select domain, volume, reach_estimate, monthly_visitors, sentiment_positive, sentiment_neutral, sentiment_negative, synced_at
  from ranked
  where rn <= 15
  order by volume desc
$$;

comment on function get_top_sites(uuid, date, date, jsonb) is
  'Bloco top_sites do envelope (aba "Visão Geral" de Autores e Influenciadores) — domínios de onde as menções se originam (bw_query_top_sites, data/volume/topsites/queries), distinto de bw_query_top_shared_sites ("Top Shared Sites", ainda sem function própria). synced_at exposto pro frontend mostrar frescor (bw-sync só re-sincroniza a cada 7 dias por par, ver isTopSitesStale em bw-sync/index.ts).';
