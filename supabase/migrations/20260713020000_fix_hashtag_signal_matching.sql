-- Módulo: foundation
-- Fonte: .dev/specs/foundation/data-model.md, narrative_matched_mentions()
--
-- Bug real encontrado 2026-07-13 (revisão pedida pelo usuário sobre a
-- pendência "extração de hashtag como campo estruturado"): a função
-- narrative_matched_mentions() já existia desde a migration inicial
-- (20260707000000) com `signal_type = 'hashtag'` casando contra
-- `mentions.tag_names` — mas `tag_names` é a feature de Tags da Brandwatch
-- (ruletags, aplicadas manualmente, explicitamente fora de escopo do MVP
-- per _index.md), não os hashtags de fato usados no post. O campo certo,
-- `mentions.insights_hashtag` (nativo `insightsHashtag`, específico de
-- X/Instagram, confirmado contra mention-metadata-field-definitions), só
-- foi adicionado depois (20260710010000) e a função nunca foi atualizada
-- pra usá-lo — corrigido aqui.
--
-- Case-insensitive (lower()) igual já feito pra author_handle, já que
-- hashtags em posts reais variam capitalização (#Eleicoes2026 vs
-- #eleicoes2026 são o "mesmo" hashtag pra fins de sinal).

create or replace function narrative_matched_mentions(
  p_narrative_id uuid,
  p_since timestamptz default null,
  p_until timestamptz default null
)
returns setof mentions
language sql
stable
as $$
  select m.*
  from mentions m
  join narratives n on n.id = p_narrative_id
  where m.organization_id = n.organization_id
    and (p_since is null or m.mention_date >= p_since)
    and (p_until is null or m.mention_date < p_until)
    and (
      (n.bw_category_id is not null and n.bw_category_id = any(m.category_ids))
      or exists (
        select 1 from narrative_signals s
        where s.narrative_id = p_narrative_id
          and s.is_active
          and (
            (s.signal_type = 'author_handle' and m.author_handle_normalized = lower(s.signal_value))
            or (s.signal_type = 'domain' and m.domain = s.signal_value)
            or (s.signal_type = 'hashtag' and lower(s.signal_value) = any(
                  select lower(h) from unnest(m.insights_hashtag) as h
                ))
            or (s.signal_type = 'keyword' and (
                  m.snippet ilike '%' || s.signal_value || '%'
                  or m.full_text ilike '%' || s.signal_value || '%'
                ))
          )
      )
    )
$$;
