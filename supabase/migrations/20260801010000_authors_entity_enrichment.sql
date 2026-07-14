-- Vínculo de Autores e Influenciadores com o Cadastro de Entidades
-- .dev/specs/entities/author-linking.md
--
-- Pedido do usuário: "revise a página e o backend de autores e
-- influenciadores e sugira novas visualizações integrando com a tabela
-- entities... totalmente interativa... partido, ideologia, menções,
-- sentimentos." Auditoria de código confirmou que `get_authors_ranking`
-- sempre devolveu `entity_id`/`risk_level` como `null` hardcoded, sem
-- nenhum `JOIN` real com `entities`/`entity_accounts` — esta migration
-- fecha esse gap, aditivamente, sem mudar nenhum cálculo de ranking já
-- existente (o `LEFT JOIN` novo entra só depois do CTE `grouped`, que
-- continua idêntico).
--
-- Também expõe `mentions` (soma de menções por autor) — já calculado
-- internamente (`g.volume`, usado só pra `order by`), nunca devolvido ao
-- client. Achado nesta mesma revisão, fechado na mesma migration por
-- tocar exatamente a mesma linha de código.
--
-- ⚠️ `p_period_start`/`p_period_end` continuam sem efeito nesta function —
-- documentado, não "corrigido": `bw_query_top_authors`/`bw_query_top_tweeters`
-- não guardam histórico por período (`metric_week` é só marcador de
-- frescor/throttle, mesmo caráter já documentado pra bw_query_topics.metric_week
-- em foundation/data-model.md) — não há dado histórico nenhum pra filtrar.

drop function if exists get_authors_ranking(uuid, date, date, jsonb, text);

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
  mentions numeric,
  risk_level text,
  entity_type text,
  entity_cargo text,
  entity_partido text,
  entity_ideologia text,
  entity_influence_level text,
  entity_tags jsonb,
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
  ),
  -- ✅ Novo (2026-08-01): vínculo com entities, 1 linha por handle
  -- (lower/trim) — desempata por created_at quando o mesmo texto de
  -- username existe em entity_accounts de duas Entities diferentes (o
  -- JOIN é só por username, nunca por platform — ver
  -- entities/author-linking.md, "Limitação aceita").
  entity_match as (
    select distinct on (lower(trim(ea.username)))
      lower(trim(ea.username)) as author_key,
      ea.entity_id
    from entity_accounts ea
    join entities e on e.id = ea.entity_id and e.is_active = true
    order by lower(trim(ea.username)), ea.created_at asc
  ),
  entity_tags_agg as (
    select
      et.entity_id,
      jsonb_agg(
        jsonb_build_object('tag_type', et.tag_type, 'tag_value', et.tag_value)
        order by et.tag_type, et.tag_value
      ) as tags
    from entity_tags et
    group by et.entity_id
  )
  select
    em.entity_id,
    g.author as name,
    coalesce(g.account_type, 'unknown') as type,
    g.reach_estimate::numeric as reach,
    g.impact as engagement,
    g.volume::numeric as mentions,
    null::text as risk_level,
    ent.type::text as entity_type,
    ent.cargo as entity_cargo,
    ent.partido as entity_partido,
    ent.ideologia as entity_ideologia,
    ent.influence_level::text as entity_influence_level,
    coalesce(eta.tags, '[]'::jsonb) as entity_tags,
    g.is_influential,
    asent.sentiment_positive,
    asent.sentiment_neutral,
    asent.sentiment_negative,
    coalesce(g.narrative_labels, '{}') as narrative_labels
  from grouped g
  left join author_sentiment asent on asent.author = g.author
  left join entity_match em on em.author_key = lower(trim(g.author))
  left join entities ent on ent.id = em.entity_id
  left join entity_tags_agg eta on eta.entity_id = em.entity_id
  order by g.volume desc nulls last
$$;

comment on function get_authors_ranking(uuid, date, date, jsonb, text) is
  'Bloco `authors` do envelope. p_scope=''pautas'' (página /themes): escopa a Subcategories da Category raiz "Pautas" em vez da Query inteira/1 Narrativa, e agrupa por autor (um autor pode ter atividade em mais de uma pauta). narrative_labels = títulos das Narrativas/pautas em que o autor apareceu no escopo pedido, sempre array (nunca null). sentiment_* nunca lê bw_query_top_authors.sentiment_* (ver nota de 20260717000000). entity_id/entity_type/entity_cargo/entity_partido/entity_ideologia/entity_influence_level/entity_tags: enriquecimento aditivo via LEFT JOIN entity_accounts (lower/trim username) -> entities (is_active=true) -> entity_tags, null/[] sem vínculo, nunca pré-requisito do ranking — ver .dev/specs/entities/author-linking.md. mentions = soma de menções por autor (g.volume), sempre presente.';
