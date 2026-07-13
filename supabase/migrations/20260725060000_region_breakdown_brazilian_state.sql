-- Pedido do usuário (2026-07-25, mesma sessão): "Precisamos de um
-- breakdown por estado brasileiro. Verifique se o módulo de fundação traz
-- esse dado, se não trouxer, ajuste a documentação e a implementação do
-- backend e frontend."
--
-- Verificado: `foundation`/`bw-sync` já sincroniza o dado necessário, sem
-- precisar de nenhuma mudança em `bw-sync` ou nova chamada à Brandwatch.
-- `bw_query_demographics_daily.dimension_type = 'region'` já é uma das 4
-- dimensões de localização buscadas pra toda Query (junto de
-- `country`/`continent`/`city`, ver `foundation/data-model.md` §5.x e
-- `bw-sync/index.ts`, `path: "regions"` → `data/volume/regions/days`),
-- desde a migration `20260711070000`. Nunca tinha function/bloco que a
-- expusesse — só existia a variante de `dimension_type = 'country'`,
-- adicionada na sessão anterior (migration `20260725010000`, decisão do
-- usuário na época: "país + net_sentiment").
--
-- ⚠️ Mesma ressalva já registrada em `foundation/data-model.md` desde que
-- essa dimensão foi implementada: o mapeamento exato de `regions`
-- (dimensão de chart da Brandwatch, entre `countries`/`continents`/
-- `cities`/`regions` — variantes mais antigas como `states`/`counties`/
-- `authorStates` são deprecated e não usadas) para "estado brasileiro"
-- (UF) **nunca foi confirmado contra um payload real** — é a leitura mais
-- plausível (hierarquia geográfica padrão da Brandwatch é continente →
-- país → região/estado → cidade, e este produto é 100% campanhas
-- brasileiras, então "regions" dentro do Brasil é razoavelmente a divisão
-- administrativa por estado), mas não uma certeza. Revisar contra logs
-- reais (`value` de linhas `dimension_type='region'`) na primeira sessão
-- com acesso a produção.
--
-- Decisão de escopo: `get_region_breakdown` passa a ler
-- `dimension_type = 'region'` (estado) em vez de `'country'`. País deixa
-- de ser exposto por este bloco — pra uma plataforma 100% de campanhas
-- brasileiras, a quebra por país é quase sempre "Brasil: 100%" (baixo
-- valor); estado é o que de fato importa operacionalmente. Mesma
-- limitação herdada da versão anterior: `bw_query_demographics_daily`
-- nunca teve `category_id`, sem como escopar por Narrativa — com
-- `filters.narratives` ativo (`narrative_detail`), a function continua
-- devolvendo vazio de propósito.
--
-- create or replace basta — mesma assinatura/retorno de `20260725010000`,
-- só o filtro de `dimension_type` no corpo muda.

create or replace function get_region_breakdown(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  label text,
  value numeric,
  pct numeric
)
language sql
stable
set search_path = public
as $$
  with cat_ids as (
    select filter_category_ids(p_organization_id, p_filters) as ids
  ),
  scoped as (
    select d.value as state, d.total_mentions, d.net_sentiment
    from bw_query_demographics_daily d
    cross join cat_ids
    where d.query_id in (select org_query_ids(p_organization_id))
      and d.dimension_type = 'region'
      and d.metric_date between p_period_start and p_period_end
      -- bw_query_demographics_daily não tem category_id — sem escopo por
      -- Narrativa possível (ver nota no topo do arquivo). Só retorna dado
      -- quando não há filtro de Narrativa ativo.
      and cat_ids.ids is null
  ),
  by_state as (
    select
      state,
      sum(total_mentions) as mentions,
      sum(net_sentiment * total_mentions) filter (where net_sentiment is not null) as weighted_sentiment,
      sum(total_mentions) filter (where net_sentiment is not null) as sentiment_weight
    from scoped
    group by state
  ),
  grand_total as (
    select sum(mentions) as total from by_state
  )
  select
    state as label,
    round(weighted_sentiment / nullif(sentiment_weight, 0), 1) as value,
    round(mentions * 100.0 / nullif((select total from grand_total), 0), 1) as pct
  from by_state
  order by mentions desc
  limit 30
$$;

comment on function get_region_breakdown(uuid, date, date, jsonb) is
  'Bloco `breakdowns` (type=region). Fonte: bw_query_demographics_daily, dimension_type=region — pedido do usuário 2026-07-25: breakdown por estado brasileiro (não mais país, ver migration 20260725060000). ⚠️ Mapeamento exato de "regions" (dimensão de chart da Brandwatch) para UF brasileira nunca foi confirmado contra um payload real, ver foundation/data-model.md. value=net_sentiment médio ponderado do estado no período, pct=participação de menções. Só cobre o escopo "Query inteira" — a tabela de origem não tem category_id, então um filtro de Narrativa ativo retorna vazio de propósito, nunca dado da Query inteira mascarado como se fosse de uma Narrativa.';
