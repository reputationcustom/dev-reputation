-- Corrige o modelo de "Pauta Eleitoral" (electoral-themes.md): até aqui,
-- QUALQUER Category raiz (bw_categories.parent_id is null) era tratada como
-- uma "Pauta" — o que confundia narrativas de crise/monitoramento gerais
-- (ex: "Pesquisas", "Banco Master", ver foundation/brandwatch-setup.md) com
-- pautas eleitorais de verdade (Educação, Saúde, Segurança...).
--
-- Pedido do usuário (2026-07-21, revisão da página `/themes`): "Essa página
-- deve focar apenas na categoria Pautas. A ideia é que a análise que compõe
-- essa página venha de todas as subcategorias de Pautas." — ou seja, existe
-- uma Category raiz específica, chamada literalmente "Pautas", e são as
-- SUBCATEGORIES dela (Educação, Saúde, Segurança, Transporte...) que são as
-- pautas eleitorais de fato — não qualquer Category raiz do Project.
--
-- Também fecha 2 pedidos feitos na mesma sessão:
-- 1. "Estrutura das pautas" deve mostrar as subcategorias da categoria
--    Pautas — já resolvido de graça pela correção de get_theme_breakdown
--    abaixo (o widget já lê breakdowns.theme, sem mudança de frontend).
-- 2. "Autores e comunidades por pauta" deve mostrar só autores que citaram
--    algo ligado às Pautas, e a quais pautas cada autor está associado
--    (pode ser mais de uma) — get_authors_ranking ganha p_scope='pautas' +
--    uma nova coluna narrative_labels.

-- =========================================================================
-- 1) pautas_root_category_id — resolve a Category raiz literalmente
-- chamada "Pautas" (case/espaço-insensitive) do Project da organização.
-- Convenção de nome, não uma coluna nova: mesmo padrão já usado em todo o
-- projeto pra vincular conceito de produto a Category da Brandwatch por
-- convenção de nomenclatura (ver brandwatch-setup.md §5, "nomear a
-- Category com o mesmo texto de narratives.title"). Se a organização ainda
-- não tem essa Category (ou o nome não bate), retorna null — toda function
-- abaixo trata null como "nenhuma pauta encontrada", nunca como erro.
-- =========================================================================

create or replace function pautas_root_category_id(p_organization_id uuid)
returns bigint
language sql
stable
set search_path = public
as $$
  select bc.id
  from bw_categories bc
  join bw_projects bp on bp.id = bc.project_id
  where bp.organization_id = p_organization_id
    and bc.parent_id is null
    and bc.status = 'active'
    and lower(btrim(bc.name)) = 'pautas'
  order by bc.id
  limit 1
$$;

comment on function pautas_root_category_id(uuid) is
  'Resolve o id da Category raiz chamada "Pautas" (bw_categories.parent_id is null, nome "Pautas" case/espaço-insensitive) do Project da organização. Usado por get_theme_breakdown/get_narratives_table(p_scope=''pautas'')/get_authors_ranking(p_scope=''pautas'') pra escopar a página /themes só às subcategorias reais de Pautas, não a qualquer Category raiz — ver CLAUDE.md, "Página Pautas Eleitorais: escopo corrigido para a categoria Pautas".';

-- =========================================================================
-- 2) get_theme_breakdown — troca "toda Category raiz" por "subcategorias
-- da Category raiz 'Pautas'". Mesma assinatura/colunas de retorno de
-- 20260716010000 (create or replace basta, sem drop). p_pauta_id continua
-- disponível pra estreitar a 1 pauta específica (ex: um clique futuro em
-- "Educação"), agora escopado dentro do universo de Pautas em vez de
-- qualquer Narrativa de topo.
-- =========================================================================

create or replace function get_theme_breakdown(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb,
  p_pauta_id uuid default null
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
  with pauta_narratives as (
    select n.id as narrative_id, n.title
    from narratives n
    join bw_categories bc on bc.id = n.bw_category_id
    where n.organization_id = p_organization_id
      and bc.status = 'active'
      and bc.parent_id = pautas_root_category_id(p_organization_id)
      and (p_pauta_id is null or n.id = p_pauta_id)
  ),
  scoped as (
    select nm.*
    from narrative_metrics nm
    join pauta_narratives pn on pn.narrative_id = nm.narrative_id
    where nm.period = 'daily'
      and nm.metric_date between p_period_start and p_period_end
  ),
  per_pauta as (
    select
      pn.narrative_id,
      pn.title,
      sum(s.total_mentions) as total_mentions,
      sum(s.net_sentiment * s.total_mentions) filter (where s.net_sentiment is not null) as weighted,
      sum(s.total_mentions) filter (where s.net_sentiment is not null) as weight
    from pauta_narratives pn
    left join scoped s on s.narrative_id = pn.narrative_id
    group by pn.narrative_id, pn.title
  ),
  grand_total as (
    select sum(total_mentions) as total from per_pauta
  )
  select
    title as label,
    round(weighted / nullif(weight, 0), 1) as value,
    round(coalesce(total_mentions, 0) * 100.0 / nullif((select total from grand_total), 0), 1) as pct
  from per_pauta
$$;

comment on function get_theme_breakdown(uuid, date, date, jsonb, uuid) is
  'Bloco `breakdowns` (type=theme) da página /themes. Escopo = subcategorias (bw_categories.parent_id) da Category raiz "Pautas" (pautas_root_category_id) — não mais "qualquer Category raiz", ver CLAUDE.md, "Página Pautas Eleitorais: escopo corrigido para a categoria Pautas".';

-- =========================================================================
-- 3) get_narratives_table — ganha um terceiro valor de p_scope ('pautas'),
-- pro bloco `narratives` da página /themes: em vez de 'leaves' (toda
-- Narrativa-filha de qualquer Category raiz), agora só as Narrativas-filha
-- cuja Category-pai é a Category raiz "Pautas". Mesma assinatura/colunas
-- de retorno de 20260721010000 (create or replace basta, sem drop).
-- =========================================================================

create or replace function get_narratives_table(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb,
  p_pauta_id uuid default null,
  p_scope text default null
)
returns table (
  id uuid,
  title text,
  sov_pct numeric,
  total_mentions integer,
  net_sentiment numeric,
  sentiment_label text,
  sentiment_positive_pct numeric,
  sentiment_neutral_pct numeric,
  sentiment_negative_pct numeric,
  momentum_score numeric,
  velocity_score numeric,
  velocity_label text,
  risk_score numeric,
  risk_label text,
  summary text,
  tags text[]
)
language sql
stable
set search_path = public
as $$
  with period_len as (
    select (p_period_end - p_period_start + 1) as days
  ),
  prev_range as (
    select (p_period_start - (select days from period_len)) as prev_start,
           (p_period_start - 1) as prev_end
  ),
  narrative_ids as (
    select nullif(array_agg((elem)::uuid), '{}') as ids
    from jsonb_array_elements_text(coalesce(p_filters -> 'narratives', '[]'::jsonb)) as elem
  ),
  scope as (
    select n.id, n.bw_category_id, n.description
    from narratives n
    join bw_categories bc on bc.id = n.bw_category_id
    cross join narrative_ids
    where n.organization_id = p_organization_id
      and bc.status = 'active'
      and (
        (
          p_pauta_id is not null
          and bc.parent_id = (select bw_category_id from narratives where id = p_pauta_id)
        )
        or (
          p_pauta_id is null
          and (
            p_scope is null
            or (p_scope = 'roots' and bc.parent_id is null)
            or (p_scope = 'leaves' and bc.parent_id is not null)
            or (p_scope = 'pautas' and bc.parent_id = pautas_root_category_id(p_organization_id))
          )
        )
      )
      and (narrative_ids.ids is null or n.id = any(narrative_ids.ids))
  ),
  latest_day as (
    select distinct on (nv.narrative_id)
      nv.narrative_id, nv.title, nv.sov_percent, nv.total_mentions,
      nv.net_sentiment, nv.sentiment_bucket, nm.query_id
    from public.narratives_overview nv
    join narrative_metrics nm
      on nm.narrative_id = nv.narrative_id and nm.metric_date = nv.metric_date and nm.period = 'daily'
    where nv.organization_id = p_organization_id
      and nv.metric_date between p_period_start and p_period_end
      and nv.narrative_id in (select id from scope)
    order by nv.narrative_id, nv.metric_date desc
  ),
  period_agg as (
    select
      narrative_id,
      sum(total_mentions) filter (where metric_date between p_period_start and p_period_end) as vol_current,
      sum(total_mentions) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as vol_previous,
      sum(engagement_total) filter (where metric_date between p_period_start and p_period_end) as engagement_current,
      sum(engagement_total) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as engagement_previous,
      avg(unique_authors) filter (where metric_date between p_period_start and p_period_end) as authors_current,
      avg(unique_authors) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as authors_previous,
      sum(reach_estimated) filter (where metric_date between p_period_start and p_period_end) as reach_current,
      sum(reach_estimated) filter (where metric_date between (select prev_start from prev_range) and (select prev_end from prev_range)) as reach_previous,
      sum(sentiment_positive) filter (where metric_date between p_period_start and p_period_end) as sentiment_positive_current,
      sum(sentiment_neutral) filter (where metric_date between p_period_start and p_period_end) as sentiment_neutral_current,
      sum(sentiment_negative) filter (where metric_date between p_period_start and p_period_end) as sentiment_negative_current
    from narrative_metrics
    where period = 'daily'
      and narrative_id in (select id from scope)
      and metric_date between (select prev_start from prev_range) and p_period_end
    group by narrative_id
  ),
  velocity_agg as (
    select
      s.id as narrative_id,
      sum(h.total_mentions) filter (where h.metric_hour >= now() - interval '3 hours') as last_3h,
      sum(h.total_mentions) filter (where h.metric_hour >= now() - interval '6 hours' and h.metric_hour < now() - interval '3 hours') as previous_3h
    from scope s
    left join bw_query_metrics_hourly h
      on h.category_id = s.bw_category_id
      and h.metric_hour >= now() - interval '6 hours'
    group by s.id
  ),
  latest_week_per_category as (
    select category_id, max(metric_week) as latest_week
    from bw_query_top_authors
    where category_id is not null
    group by category_id
  ),
  author_influence_agg as (
    select
      s.id as narrative_id,
      count(*) filter (where a.is_influential) * 100.0 / nullif(count(*), 0) as author_influence
    from scope s
    join latest_week_per_category lw on lw.category_id = s.bw_category_id
    left join bw_query_top_authors a on a.category_id = s.bw_category_id and a.metric_week = lw.latest_week
    group by s.id
  ),
  momentum as (
    select
      ld.narrative_id,
      round(
        0.40 * norm_growth(pa.vol_current, pa.vol_previous) +
        0.25 * norm_growth(pa.engagement_current, pa.engagement_previous) +
        0.20 * norm_growth(pa.authors_current, pa.authors_previous) +
        0.15 * norm_growth(pa.reach_current, pa.reach_previous)
      ) as momentum_score
    from latest_day ld
    left join period_agg pa on pa.narrative_id = ld.narrative_id
  ),
  velocity as (
    select
      ld.narrative_id,
      norm_growth(va.last_3h, va.previous_3h) as velocity_score
    from latest_day ld
    left join velocity_agg va on va.narrative_id = ld.narrative_id
  ),
  risk_inputs as (
    select
      ld.narrative_id,
      greatest(0, least(100, (100 - coalesce(ld.net_sentiment, 0)) / 2.0)) as sentiment_risk,
      m.momentum_score,
      v.velocity_score,
      coalesce(pa.reach_current, 0) * 100.0 / nullif(max(coalesce(pa.reach_current, 0)) over (partition by ld.query_id), 0) as reach_risk,
      coalesce(pa.engagement_current, 0) * 100.0 / nullif(max(coalesce(pa.engagement_current, 0)) over (partition by ld.query_id), 0) as impact_risk,
      coalesce(ai.author_influence, 0) as author_influence
    from latest_day ld
    left join period_agg pa on pa.narrative_id = ld.narrative_id
    left join momentum m on m.narrative_id = ld.narrative_id
    left join velocity v on v.narrative_id = ld.narrative_id
    left join author_influence_agg ai on ai.narrative_id = ld.narrative_id
  ),
  risk as (
    select
      narrative_id,
      round(
        0.25 * sentiment_risk +
        0.25 * coalesce(momentum_score, 50) +
        0.20 * coalesce(velocity_score, 50) +
        0.15 * coalesce(reach_risk, 0) +
        0.10 * author_influence +
        0.05 * coalesce(impact_risk, 0)
      ) as risk_score
    from risk_inputs
  ),
  tag_latest_week as (
    select bqt.category_id, max(bqt.metric_week) as w
    from bw_query_topics bqt
    where bqt.category_id in (select bw_category_id from scope)
      and bqt.topic_type in ('hashtags', 'phrases', 'words')
    group by bqt.category_id
  ),
  tag_ranked as (
    select
      t.category_id,
      t.label,
      row_number() over (partition by t.category_id order by t.volume desc nulls last) as rn
    from bw_query_topics t
    join tag_latest_week lw on lw.category_id = t.category_id and lw.w = t.metric_week
    where t.topic_type in ('hashtags', 'phrases', 'words')
  ),
  tags_by_category as (
    select category_id, array_agg(label order by rn) as tags
    from tag_ranked
    where rn <= 6
    group by category_id
  )
  select
    ld.narrative_id as id,
    ld.title,
    ld.sov_percent as sov_pct,
    ld.total_mentions,
    ld.net_sentiment,
    ld.sentiment_bucket as sentiment_label,
    round(coalesce(pa.sentiment_positive_current, 0) * 100.0 / nullif(coalesce(pa.sentiment_positive_current, 0) + coalesce(pa.sentiment_neutral_current, 0) + coalesce(pa.sentiment_negative_current, 0), 0), 1) as sentiment_positive_pct,
    round(coalesce(pa.sentiment_neutral_current, 0) * 100.0 / nullif(coalesce(pa.sentiment_positive_current, 0) + coalesce(pa.sentiment_neutral_current, 0) + coalesce(pa.sentiment_negative_current, 0), 0), 1) as sentiment_neutral_pct,
    round(coalesce(pa.sentiment_negative_current, 0) * 100.0 / nullif(coalesce(pa.sentiment_positive_current, 0) + coalesce(pa.sentiment_neutral_current, 0) + coalesce(pa.sentiment_negative_current, 0), 0), 1) as sentiment_negative_pct,
    m.momentum_score,
    v.velocity_score,
    case
      when v.velocity_score is null then null
      when v.velocity_score < 20 then 'shrinking_fast'
      when v.velocity_score < 40 then 'declining'
      when v.velocity_score < 60 then 'stable'
      when v.velocity_score < 80 then 'growing'
      else 'viral'
    end as velocity_label,
    r.risk_score,
    case
      when r.risk_score is null then null
      when r.risk_score < 34 then 'low'
      when r.risk_score < 60 then 'medium'
      when r.risk_score < 85 then 'high'
      else 'critical'
    end as risk_label,
    s.description as summary,
    coalesce(tc.tags, '{}') as tags
  from latest_day ld
  join scope s on s.id = ld.narrative_id
  left join period_agg pa on pa.narrative_id = ld.narrative_id
  left join momentum m on m.narrative_id = ld.narrative_id
  left join velocity v on v.narrative_id = ld.narrative_id
  left join risk r on r.narrative_id = ld.narrative_id
  left join tags_by_category tc on tc.category_id = s.bw_category_id
  order by r.risk_score desc nulls last, ld.total_mentions desc nulls last
$$;

comment on function get_narratives_table(uuid, date, date, jsonb, uuid, text) is
  'Bloco `narratives` do envelope. p_scope: null = sem filtro extra, ''roots'' = só Category de topo, ''leaves'' = só Subcategory de qualquer Category, ''pautas'' = só Subcategory cuja Category-pai é a Category raiz "Pautas" (pautas_root_category_id) — usado pela página /themes desde a correção de escopo, ver CLAUDE.md, "Página Pautas Eleitorais: escopo corrigido para a categoria Pautas". sentiment_positive_pct/neutral_pct/negative_pct/summary/tags ver nota de 20260721010000.';

-- =========================================================================
-- 4) get_authors_ranking — ganha p_scope ('pautas' | null) e uma nova
-- coluna narrative_labels text[]. Pedido do usuário: "em Autores e
-- comunidades por pauta deve aparecer apenas os autores que citaram algo
-- relacionado às Pautas e deve ser informado a que pauta ele está
-- associado, e poderá ser mais de uma."
--
-- p_scope='pautas': escopa a busca às Subcategories de "Pautas"
-- diretamente (ignora p_filters->'narratives' pra esse fim — a página
-- /themes não tem seletor de Narrativa único, ela É o universo de Pautas)
-- em vez do comportamento default (Query inteira quando sem filtro, ou a(s)
-- Narrativa(s) de filters.narratives). Um autor pode aparecer em
-- bw_query_top_authors uma vez por Category/Subcategory em que teve
-- atividade — por isso o resultado agora agrupa por autor (sum de
-- reach/impact entre as pautas em que aparece; ⚠️ pode inflar levemente o
-- alcance/engajamento somado se uma mesma mention estiver categorizada em
-- mais de uma pauta simultaneamente na Brandwatch — mesmo trade-off aceito
-- em qualquer soma sobre agregados por-Category já existente no projeto,
-- não um cálculo novo sobre `mentions` amostrada) e devolve
-- narrative_labels = array com o título de cada Narrativa (pauta) em que o
-- autor apareceu no escopo pedido. Fora do escopo 'pautas', o agrupamento é
-- inofensivo (só 1 categoria pode bater por vez hoje: Query inteira ou 1
-- Narrativa via filters.narratives), então nenhuma outra página muda de
-- comportamento — só passa a preencher narrative_labels honestamente em
-- vez de nunca expor essa informação.
-- =========================================================================

drop function if exists get_authors_ranking(uuid, date, date, jsonb);

create or replace function get_authors_ranking(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb,
  p_scope text default null
)
returns table (
  entity_id uuid,
  name text,
  type text,
  reach numeric,
  engagement numeric,
  risk_level text,
  is_influential boolean,
  sentiment_positive integer,
  sentiment_neutral integer,
  sentiment_negative integer,
  narrative_labels text[]
)
language sql
stable
set search_path = public
as $$
  with cat_ids as (
    select case
      when p_scope = 'pautas' then (
        select array_agg(bc.id)
        from bw_categories bc
        where bc.parent_id = pautas_root_category_id(p_organization_id)
          and bc.status = 'active'
      )
      else filter_category_ids(p_organization_id, p_filters)
    end as ids
  ),
  use_tweeters as (
    select coalesce((p_filters -> 'platforms') ? 'twitter', false)
        or coalesce((p_filters -> 'platforms') ? 'x', false) as flag
  ),
  scoped_authors as (
    select author, volume, reach_estimate, impact, account_type, is_influential, metric_week, category_id, query_id
    from bw_query_top_authors
    where not (select flag from use_tweeters)
    union all
    select author, volume, reach_estimate, impact, account_type, is_influential, metric_week, category_id, query_id
    from bw_query_top_tweeters
    where (select flag from use_tweeters)
  ),
  filtered as (
    select sa.*
    from scoped_authors sa
    cross join cat_ids
    where sa.query_id in (select org_query_ids(p_organization_id))
      and (
        (p_scope = 'pautas' and cat_ids.ids is not null and sa.category_id = any(cat_ids.ids))
        or (
          p_scope is distinct from 'pautas'
          and (
            (cat_ids.ids is null and sa.category_id is null)
            or sa.category_id = any(cat_ids.ids)
          )
        )
      )
  ),
  latest_week as (
    select max(metric_week) as w from filtered
  ),
  ranked as (
    select *
    from filtered
    where metric_week = (select w from latest_week)
  ),
  author_sentiment as (
    select
      at.author,
      sum(at.sentiment_positive) as sentiment_positive,
      sum(at.sentiment_neutral) as sentiment_neutral,
      sum(at.sentiment_negative) as sentiment_negative
    from bw_query_author_topics at
    where at.query_id in (select org_query_ids(p_organization_id))
      and at.metric_week = (
        select max(at2.metric_week) from bw_query_author_topics at2 where at2.author = at.author
      )
    group by at.author
  ),
  narrative_titles as (
    select bw_category_id, title
    from narratives
    where organization_id = p_organization_id
      and bw_category_id is not null
  ),
  grouped as (
    select
      r.author,
      (array_agg(r.account_type order by coalesce(r.volume, 0) desc))[1] as account_type,
      sum(r.reach_estimate) as reach_estimate,
      sum(r.impact) as impact,
      sum(r.volume) as volume,
      bool_or(coalesce(r.is_influential, false)) as is_influential,
      array_agg(distinct nt.title) filter (where nt.title is not null) as narrative_labels
    from ranked r
    left join narrative_titles nt on nt.bw_category_id = r.category_id
    group by r.author
  )
  select
    null::uuid as entity_id,
    g.author as name,
    coalesce(g.account_type, 'unknown') as type,
    g.reach_estimate::numeric as reach,
    g.impact as engagement,
    null::text as risk_level,
    g.is_influential,
    asent.sentiment_positive,
    asent.sentiment_neutral,
    asent.sentiment_negative,
    coalesce(g.narrative_labels, '{}') as narrative_labels
  from grouped g
  left join author_sentiment asent on asent.author = g.author
  order by g.volume desc nulls last
$$;

comment on function get_authors_ranking(uuid, date, date, jsonb, text) is
  'Bloco `authors` do envelope. p_scope=''pautas'' (página /themes): escopa a Subcategories da Category raiz "Pautas" em vez da Query inteira/1 Narrativa, e agrupa por autor (um autor pode ter atividade em mais de uma pauta). narrative_labels = títulos das Narrativas/pautas em que o autor apareceu no escopo pedido, sempre array (nunca null) — ver CLAUDE.md, "Página Pautas Eleitorais: escopo corrigido para a categoria Pautas". sentiment_* ver nota de 20260717000000 (nunca lê bw_query_top_authors.sentiment_*).';

-- =========================================================================
-- 5) Backfill: reverte o título das Narrativas-folha (Subcategory) de volta
-- pra "<nome da própria Subcategory>", desfazendo o formato "Categoria -
-- Subcategoria" aplicado em 20260720000000 — pedido do usuário (mesma
-- sessão): "Para facilitar vamos considerar apenas as subcategorias em
-- todas as narrativas. Retire a regra de 'categoria - subcategoria'."
-- Toda página agora lista só Narrativas-folha (narrativesScopeForPage,
-- 'leaves'/'pautas' — nunca mais Category raiz + Subcategory juntas na
-- mesma lista), então o prefixo do nome da Category-pai deixou de resolver
-- alguma ambiguidade real. bw-sync/index.ts (buildNarrativeTitle) já para
-- de compor o título pra qualquer Narrativa nova a partir de agora; este
-- backfill só corrige as que já existem. Seguro por construção (mesma
-- justificativa já usada em 20260720000000 pro sentido inverso): não há
-- CRUD de Narrativa em lugar nenhum do produto — narratives.title é 100%
-- derivado de bw_categories.name, nunca editado à mão.
-- =========================================================================

update narratives n
set title = bc.name
from bw_categories bc
where bc.id = n.bw_category_id
  and bc.parent_id is not null
  and n.title <> bc.name;
