-- Módulo: foundation
-- Pedido do usuário (2026-07-20): "Alterar a lógica de definição da
-- narrativa. 1) O nome da narrativa será composto por 'categoria -
-- subcategoria'. 2) Tanto na página de overview quanto na lista de
-- narrativas serão mostradas todas as narrativas. 3) Revise se os valores
-- de sentimento por narrativa estão corretos, no Frontend está tudo
-- neutro, não corresponde a realidade."
--
-- Item 2 (overview/narrativas mostram todas as Narrativas, não só
-- roots/leaves) não precisa de migration — get_narratives_table já suporta
-- p_scope = null (retorna tudo, sem filtro de parent_id), ver migration
-- 20260716010000. A troca é só no service layer
-- (supabase/functions-shared-source/aggregated-metrics-service.ts +
-- cópias nas Edge Functions), ver commit desta sessão.
--
-- =========================================================================
-- Item 1 — título "Categoria - Subcategoria"
--
-- ensureNarrativesFromCategories() (bw-sync/index.ts) passou a compor
-- title = "<nome da Category-pai> - <nome da Subcategory>" pra toda
-- Narrativa nova cuja Category tem parent_id (Category de topo continua só
-- com o próprio nome). Motivo: com o item 2 acima, Overview e a aba
-- Narrativas agora listam Category (Pauta) e Subcategory juntas na mesma
-- tabela plana — um título de Subcategory sozinho ("Vacinação") fica
-- ambíguo sem indicar de qual Pauta ele é filho quando aparece ao lado de
-- outras Pautas/Subcategories.
--
-- bw-sync só aplica esse formato a Narrativas NOVAS daqui pra frente
-- (idempotente por design — nunca sobrescreve title de uma Narrativa já
-- existente, ver foundation/narratives.md). Backfill abaixo recalcula o
-- título de toda Narrativa já existente pro novo formato — seguro porque
-- não há CRUD de Narrativas em nenhuma camada do produto
-- (foundation/narratives.md, "Interface (UI)", decisão fechada
-- 2026-07-13: "não há, e não haverá, tela de CRUD de Narrativas") — ou
-- seja, todo `title` hoje em produção é 100% derivado de
-- `bw_categories.name`/`parent_id`, nunca editado manualmente, então
-- recompute-lo inteiro não corre risco de apagar uma edição de analista.
update narratives n
set title = case
  when bc.parent_id is null then bc.name
  else coalesce(parent.name || ' - ' || bc.name, bc.name)
end
from bw_categories bc
left join bw_categories parent on parent.id = bc.parent_id
where n.bw_category_id = bc.id;

-- =========================================================================
-- Item 3 — sentiment_bucket "sempre neutro"
--
-- public.narratives_overview.sentiment_bucket prioriza net_sentiment
-- (score oficial da Brandwatch, 7 faixas, ver migration 20260713030000) e
-- só cai pro cálculo local (fallback) enquanto net_sentiment ainda não
-- sincronizou pra aquele dia/Narrativa. Dois problemas reais encontrados
-- nesta auditoria, ambos corrigidos:
--
-- (a) O fallback tinha uma fórmula matematicamente enviesada pra 'neutral':
--     (sentiment_positive - sentiment_negative) / total_mentions, com
--     limiar de ±20%. Dividir pelo TOTAL de mentions (que inclui as
--     neutras) dilui o resultado sempre que uma fatia relevante das
--     mentions é neutra/factual — comum em cobertura política — exigindo
--     um desequilíbrio grande demais pra sair da faixa 'neutral' mesmo
--     quando a proporção entre só as mentions classificadas (positivas vs.
--     negativas) já indicaria um sentimento claro. net_sentiment (a fonte
--     oficial/primária) já usa a base correta — positivo/(positivo+
--     negativo) — então o fallback local devia espelhar a mesma definição,
--     não uma métrica diferente. Corrigido: fallback agora normaliza por
--     (sentiment_positive + sentiment_negative), reusando as mesmas 7
--     faixas de net_sentiment, e só cai em 'neutral' quando não há
--     nenhuma mention classificada (positivo+negativo = 0, ou seja,
--     100% das mentions do dia são de fato neutras — caso em que
--     'neutral' é a resposta correta, não um artefato da fórmula).
-- (b) runDailyMetricsStep() (bw-sync/index.ts, fase daily_metrics) fazia as
--     2 chamadas de net_sentiment (dimensão categories/queries) por ÚLTIMO
--     entre as 10 chamadas fixas de agregado, depois de reachEstimate/
--     engagementScore/authors/impressions × categories+queries — em
--     qualquer invocação com Narrativas suficientes pro orçamento de 25
--     chamadas (BRANDWATCH_CALL_BUDGET) se esgotar antes de chegar nelas,
--     net_sentiment nunca sincronizava, empurrando o cálculo pro fallback
--     do item (a) com muito mais frequência do que deveria. Corrigido no
--     código (não nesta migration): as 2 chamadas de netSentiment agora
--     rodam logo após o loop de sentimento, antes de qualquer outro
--     agregado desta fase.
--
-- Corpo copiado de 20260713030000 (última versão do SELECT), só a CTE
-- `daily` (novo campo local_net_sentiment) e a expressão de
-- sentiment_bucket mudam — nenhuma coluna de saída nova, mesma posição das
-- existentes (create or replace view não permite reordenar/remover
-- colunas já expostas, ver comentário original em 20260713030000).
create or replace view public.narratives_overview as
with daily as (
  select narrative_id, query_id, metric_date, total_mentions,
         sentiment_positive, sentiment_neutral, sentiment_negative,
         net_sentiment, reach_estimated, engagement_total, unique_authors,
         case
           when coalesce(sentiment_positive, 0) + coalesce(sentiment_negative, 0) > 0
           then (sentiment_positive - sentiment_negative)::numeric * 100.0
                / (sentiment_positive + sentiment_negative)
           else null
         end as local_net_sentiment,
         lag(total_mentions) over (partition by narrative_id order by metric_date) as prev_total_mentions
  from narrative_metrics
  where period = 'daily'
),
query_totals as (
  select metric_date, query_id, sum(total_mentions) as query_total_mentions
  from narrative_metrics
  where period = 'daily' and query_id is not null
  group by metric_date, query_id
)
select
  n.id as narrative_id,
  n.organization_id,
  n.title,
  n.stage,
  n.risk_level,
  d.metric_date,
  d.total_mentions,
  round(100.0 * d.total_mentions / nullif(t.query_total_mentions, 0), 1) as sov_percent,
  round(100.0 * (d.total_mentions - d.prev_total_mentions) / nullif(d.prev_total_mentions, 0), 1) as trend_percent,
  coalesce(
    case
      when d.net_sentiment >= 50 then 'very_positive'
      when d.net_sentiment >= 20 then 'positive'
      when d.net_sentiment >= 5 then 'slightly_positive'
      when d.net_sentiment >= -4 then 'neutral'
      when d.net_sentiment >= -19 then 'slightly_negative'
      when d.net_sentiment >= -49 then 'negative'
      when d.net_sentiment is not null then 'very_negative'
    end,
    case
      when d.local_net_sentiment >= 50 then 'very_positive'
      when d.local_net_sentiment >= 20 then 'positive'
      when d.local_net_sentiment >= 5 then 'slightly_positive'
      when d.local_net_sentiment >= -4 then 'neutral'
      when d.local_net_sentiment >= -19 then 'slightly_negative'
      when d.local_net_sentiment >= -49 then 'negative'
      when d.local_net_sentiment is not null then 'very_negative'
      else 'neutral'
    end
  ) as sentiment_bucket,
  d.net_sentiment,
  d.reach_estimated,
  d.engagement_total,
  d.unique_authors
from narratives n
join daily d on d.narrative_id = n.id
left join query_totals t on t.metric_date = d.metric_date and t.query_id = d.query_id;

comment on view public.narratives_overview is
  'View usada pela tabela interativa de Narrativas no Executive Overview (via PostgREST/RLS). sov_percent = menções da Narrativa / total de menções de todas as Narrativas da MESMA Query (candidato/monitoramento) no mesmo dia. sentiment_bucket usa net_sentiment (score oficial da Brandwatch, 7 faixas) com fallback pro cálculo local (local_net_sentiment = positivo/(positivo+negativo), mesma definição de net_sentiment, não mais diluído pelo total de mentions) só enquanto net_sentiment não sincronizou. Momentum/Velocidade/Risco (scores 0-100) NÃO vivem nesta view — são período-dependentes e ficam em aggregated-metrics.get_narratives_table().';

create or replace view reporting.narratives_overview as
select * from public.narratives_overview;
