-- ai-synthesis.md — Camada 1 acompanha o radar (2026-07-14). Pedido do
-- usuário: "esse resumo executivo precisa acompanhar o radar, se aparecer
-- algo novo no radar, refaz o resumo executivo. Além disso, atualiza
-- automaticamente de hora em hora." A recomposição a cada
-- AI_SYNTHESIS_REFRESH_HOURS (2026-07-14, mais cedo na mesma data) só
-- cobre o lado "tempo" — nada disparava uma recomposição quando um
-- feed_events (evento do radar) genuinamente novo aparecia antes da
-- janela de tempo fechar. get_active_highlights ganha `created_at`
-- (feed_events.created_at, já existia na tabela, nunca exposto por esta
-- function) — é o dado que falta pro service layer
-- (aggregated-metrics-service.ts) comparar o highlight mais recente
-- contra page_narrative_synthesis.generated_at e decidir "algo novo
-- apareceu desde a última composição", independente da janela de tempo.
--
-- drop function necessário — adiciona coluna de saída, create or replace
-- sozinho não basta (CLAUDE.md, "Migration hygiene": mudar a lista de
-- colunas de saída de uma function RETURNS TABLE exige drop explícito).

drop function if exists get_active_highlights(uuid, date, date, jsonb);

create or replace function get_active_highlights(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  event_type text,
  severity severity_level,
  severity_score numeric,
  title text,
  summary text,
  explanation text,
  recommendation text,
  confidence numeric,
  tags text[],
  related_narrative_id uuid,
  related_entity_id uuid,
  created_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with narrative_ids as (
    select nullif(array_agg((elem)::uuid), '{}') as ids
    from jsonb_array_elements_text(coalesce(p_filters -> 'narratives', '[]'::jsonb)) as elem
  )
  select
    fe.event_type,
    fe.severity,
    fe.severity_score,
    fe.title,
    fe.summary,
    fe.description as explanation,
    fe.recommendation,
    fe.confidence,
    coalesce(fe.tags, '{}'),
    fe.related_narrative_id,
    fe.related_entity_id,
    fe.created_at
  from feed_events fe
  cross join narrative_ids
  where fe.organization_id = p_organization_id
    and fe.created_at::date between p_period_start and p_period_end
    and (narrative_ids.ids is null or fe.related_narrative_id = any(narrative_ids.ids))
  order by fe.severity_score desc nulls last, fe.created_at desc
  limit 30
$$;

comment on function get_active_highlights(uuid, date, date, jsonb) is
  'Bloco `highlights` do envelope (sql-aggregation.md, A1 de event-radar/fluxo-aggregated-metrics.md "Fase B"). Leitura pura de feed_events — nunca recalcula severidade/detecção (essa lógica pertence só ao event-radar). Escopo: organization_id sempre; filters.narratives (quando presente) restringe a related_narrative_id — único filtro de EnvelopeFilters realmente aplicado hoje, mesmo padrão de toda outra function deste módulo. period_start/period_end filtram por feed_events.created_at (data de publicação do card, não a janela de detecção do evento). Sem filtro de closed_at de propósito — um evento fechado dentro do período pedido ainda é um insight relevante pra quem está olhando aquele período; "ativo" (closed_at is null) só importa pro boost de risk_score em get_narratives_table (A2), não pra este bloco de listagem. Limit 30: o cap diário de 15 eventos/organização (event-radar 1.6) já bounda o volume por dia, este limite é só uma salvaguarda de payload pra períodos multi-dia. created_at (2026-07-14): permite ao service layer (fetchNarrativeText/ai-synthesis Camada 1) detectar "novo evento desde a última composição" sem depender só da janela de tempo AI_SYNTHESIS_REFRESH_HOURS.';
