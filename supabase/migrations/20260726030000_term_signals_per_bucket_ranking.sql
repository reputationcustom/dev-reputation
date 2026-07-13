-- Pedido do usuário (2026-07-25): "Verifique por que os Drivers positivos
-- não estão aparecendo."
--
-- Auditoria: `get_term_signals` (migration 20260714000000) classifica cada
-- termo em positive/neutral/negative (comparando sentiment_positive/
-- neutral/negative de bw_query_topics) — essa parte está correta e
-- simétrica, sem bug de classificação. O problema real está ANTES da
-- classificação: a function ordena TODOS os termos por `trending`
-- (crescimento) e corta em `limit 50` — um único ranking global, não um
-- ranking por sentimento. `PositiveDriversList`/`NegativeDriversList`
-- (term-signals-list.tsx) então filtram esses 50 já cortados. Resultado:
-- se os termos que mais crescem (`trending` mais alto) num período
-- específico forem majoritariamente de sentimento negativo/neutro — bem
-- plausível em cobertura política, onde notícias negativas costumam viralizar
-- mais rápido — o corte de 50 pode não sobrar nenhum termo genuinamente
-- "positivo" antes mesmo do filtro por sentimento rodar, mesmo que existam
-- termos positivos reais mais abaixo no ranking geral (só não estão entre
-- os 50 que mais crescem). Os Drivers negativos não sofrem o mesmo
-- problema simplesmente porque, nesse cenário, são maioria dentro do
-- corte — não há bug simétrico visível do lado deles, mas a causa é a
-- mesma estrutura de corte único.
--
-- Corrigido: ranking agora é FEITO DENTRO DE CADA BUCKET DE SENTIMENTO
-- (row_number() over (partition by sentiment_associated order by
-- growth_pct desc)), top 20 de cada bucket (positive/neutral/negative),
-- não mais um corte único de 50 global por trending. Garante que
-- "Drivers positivos" sempre tem acesso aos termos mais relevantes DENTRO
-- do próprio universo positivo, sem ser espremido pelo volume de termos
-- negativos/neutros que cresceram mais rápido no período. `TermSignalsList`
-- (nuvem de palavras em /themes, que não filtra por sentimento) e
-- `PositiveDriversList`/`NegativeDriversList` (que já fatiam top 10 cada)
-- continuam funcionando sem mudança de código no frontend — só recebem um
-- pool mais equilibrado.
--
-- Mesma assinatura/retorno de 20260714000000 — create or replace basta.

create or replace function get_term_signals(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  term text,
  growth_pct numeric,
  sentiment_associated text
)
language sql
stable
set search_path = public
as $$
  with cat_ids as (
    select filter_category_ids(p_organization_id, p_filters) as ids
  ),
  scoped_base as (
    select t.*
    from bw_query_topics t
    cross join cat_ids
    where t.query_id in (select org_query_ids(p_organization_id))
      and (
        (cat_ids.ids is null and t.category_id is null)
        or t.category_id = any(cat_ids.ids)
      )
  ),
  latest as (
    select max(metric_week) as w from scoped_base
  ),
  classified as (
    select
      label as term,
      trending as growth_pct,
      case
        when sentiment_positive >= sentiment_neutral and sentiment_positive >= sentiment_negative then 'positive'
        when sentiment_negative >= sentiment_neutral and sentiment_negative >= sentiment_positive then 'negative'
        else 'neutral'
      end as sentiment_associated
    from scoped_base
    where metric_week = (select w from latest)
  ),
  ranked as (
    select
      term,
      growth_pct,
      sentiment_associated,
      row_number() over (partition by sentiment_associated order by growth_pct desc nulls last) as rn
    from classified
  )
  select term, growth_pct, sentiment_associated
  from ranked
  where rn <= 20
  order by sentiment_associated, growth_pct desc nulls last
$$;

comment on function get_term_signals(uuid, date, date, jsonb) is
  'Bloco `term_signals`. Fonte: bw_query_topics (label/trending/sentiment_positive/neutral/negative), snapshot mais recente (metric_week), sem filtro de p_period_start/p_period_end (marcador de frescor, não bucket de calendário real). Ranking (correção 20260726030000) é feito DENTRO de cada bucket de sentimento (top 20 positive/neutral/negative cada, por growth_pct desc) — não mais um corte único de 50 por trending global, que podia esvaziar o bucket "positive" quando termos negativos/neutros cresciam mais rápido no período (causa raiz de "Drivers positivos não aparecem", reportado pelo usuário).';
