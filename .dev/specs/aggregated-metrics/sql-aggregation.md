---
tipo: feature-spec
módulo: aggregated-metrics
funcionalidade: sql-aggregation
status: pronto
atualizado: 2026-07-12
---

# Camada SQL de Agregação

## Objetivo

Cada bloco do envelope deve ser calculado por uma function SQL (Postgres, via Supabase RPC)
reutilizável entre páginas — nunca por agregação feita em JavaScript dentro da Edge Function, e
nunca por soma/contagem local sobre `mentions`. `foundation`/`sync-brandwatch` já sincroniza os
agregados oficiais e não amostrados da Brandwatch (`bw_query_metrics_daily`/`weekly`/`monthly`,
`bw_query_metrics_daily_by_platform`, `bw_query_topics`, `bw_query_top_authors`,
`narrative_metrics` — ver `foundation/data-model.md`) — este módulo lê deles, não recalcula.

## Regra fundamental

> ⚠️ Nenhuma function deste módulo deve fazer `SELECT ... FROM mentions` e agregar em memória ou
> em SQL para representar um total/percentual/série. Essa é a mesma premissa já fixada em
> `_index.md`/`CLAUDE.md` ("nunca calcular localmente sobre mentions amostrada") depois de um bug
> de produção real (SOV calculado errado por agregação local) — vale integralmente para este
> módulo. A única leitura direta de `mentions` permitida é por-linha, nunca agregada: a lista de
> "conteúdos de destaque"/"menções relevantes" (mentions individuais, já com esse padrão em
> `intelligence-center/narratives-exploration.md`) e o grafo de disseminação simplificado
> (`get_dissemination_graph` abaixo — relação `reply_to`/`retweet_of`/`insights_mentioned` por
> mention, não uma soma).

## Functions a implementar

O Claude Code deve criar uma function por tipo de bloco, com assinatura consistente
`(organization_id uuid, period_start date, period_end date, filters jsonb)`, exceto onde
observado — **sem `query_id`** (revertido 2026-07-13, ver nota abaixo).

> ⚠️ **Uma organização pode ter 1+ Queries** (`bw_queries.project_id → bw_projects.organization_id`,
> um Project por organização com N Queries dentro — ex: N candidatos ou N canais acompanhados
> pela mesma organização), **mas isso nunca é exposto ao client** — pedido explícito do usuário
> (2026-07-13): "o seletor de organização é independente de Query... as Queries devem ser
> transparentes para o usuário final". Cada function abaixo resolve `query_id` **internamente**
> a partir de `organization_id` (`select id from bw_queries where project_id in (select id from
> bw_projects where organization_id = p_organization_id)`) e combina o resultado:
> - Blocos agregados/numéricos (`metrics`, `breakdowns`, `trends`): **soma** entre as Queries da
>   organização (`total_mentions`, `sentiment_*` etc. — todos já são contagens, somar é correto).
> - `narratives` (`get_narratives_table`): **união** das Narrativas de todas as Queries da
>   organização numa lista só — mas o SOV de cada linha continua calculado contra o total da
>   **sua própria Query** (`narrative_metrics.query_id`), nunca contra o total combinado da
>   organização. É exatamente a distinção que evita reintroduzir o bug de SOV de 2026-07-11
>   (agrupar por organização inteira em vez de por Query) — a diferença agora é que o usuário
>   nunca escolhe a Query, só vê a lista combinada com cada SOV já correto.

| Function                              | Bloco que alimenta | Tabela(s) de origem real                              |
|-----------------------------------------|---------------------|-------------------------------------------------|
| `get_metrics_cards(...)`                | `metrics`           | `bw_query_metrics_daily`/`weekly`/`monthly` com `category_id is null` (Query inteira): `total_mentions`, `sentiment_*`, `reach_estimate`, `engagement_score`, `unique_authors` |
| `get_sentiment_breakdown(...)`          | `breakdowns`        | `bw_query_metrics_daily`/`weekly`/`monthly` (campos `sentiment_positive/neutral/negative`) |
| `get_platform_breakdown(...)`           | `breakdowns`        | `bw_query_metrics_daily_by_platform` (`category_id is null` para o total; `net_sentiment` quando o breakdown for de sentimento por plataforma — ver limitação de score único em `intelligence-center/sentiment-analysis.md`) |
| `get_theme_breakdown(...)`              | `breakdowns`        | `narrative_metrics`/`narratives` filtrado a `bw_category_id` apontando para `bw_categories` raiz (`parent_id is null`) — mesma definição de "Pauta" já fechada em `intelligence-center/electoral-themes.md`, não uma segunda |
| `get_volume_trend(...)`                 | `trends`             | `bw_query_metrics_daily`/`weekly`/`monthly`, reaproveitando a regra de granularidade automática já especificada em `foundation/overview.md` ("Tabela interativa de Narrativas"/gráfico de volume) — não redefinir aqui |
| `get_narratives_table(...)`             | `narratives`         | `reporting.narratives_overview`/`public.narratives_overview` (view já existente, ver `foundation/data-model.md`) pro dado bruto por dia (`sov_percent`, `net_sentiment`/`sentiment_bucket`, `total_mentions`, `reach_estimated`, `engagement_total`, `unique_authors`) — **mas** os 3 scores derivados e período-dependentes (`momentum_score`, `velocity_score`, `risk_score`) são calculados **nesta function**, não na view (a view não recebe `period_start`/`period_end`) — ver seção "Scores de Narrativa" abaixo |
| `get_authors_ranking(...)`              | `authors`            | `bw_query_top_authors`/`bw_query_top_tweeters` (quando o escopo for X) — nativos da Brandwatch, não amostrados. `entity_id`/classificação por partido/espectro fica `null` até `entities` (Sprint 2) existir; quando existir, `LEFT JOIN entity_tags` via `entity_accounts.username = bw_query_top_authors.author` é enriquecimento aditivo, nunca pré-requisito do ranking |
| `get_dissemination_graph(narrative_id)` | `graph`              | `mentions` (`reply_to`/`retweet_of`/`insights_mentioned`), restrito às mentions retornadas por `narrative_matched_mentions(narrative_id)` — reusa a função canônica já definida em `foundation/data-model.md`, mesma abordagem já decidida em `intelligence-center/narratives-exploration.md` ("grafo de disseminação simplificado"), não uma tabela `grafo_arestas` nova |
| `get_term_signals(...)`                 | `term_signals`       | `bw_query_topics` (`label`, `sentiment_positive/neutral/negative`, `trending`) — já carrega tema/sentimento/tendência, não precisa extrair termo de `mentions` |
| `get_active_highlights(...)`            | `highlights`         | `feed_events` (populada pelo módulo `event-radar`, tipo/tag `"radar"`) — **leitura pura, sem cálculo**: filtra por `organization_id`, `period`, escopo da página (narrativa/pauta/plataforma quando aplicável) e ordena por `severity_score` desc, respeitando o cap diário já aplicado na inserção pelo radar |

## Scores de Narrativa: Sentimento, Momentum, Velocidade e Risco

> ✅ Especificado 2026-07-13, a pedido do usuário, substituindo os 2
> ⚠️ DECISÃO PENDENTE que existiam pra Sentimento/Momentum em
> `intelligence-center/executive-overview.md` e introduzindo 2 indicadores
> novos (Velocidade, separada de Momentum; Risco como score, não só
> `narratives.risk_level`). Todos os 4 scores são calculados **uma vez, aqui**
> (dentro de `get_narratives_table`) e reaproveitados por toda página que
> mostra a tabela de Narrativas (`executive-overview.md`,
> `narratives-exploration.md`, `electoral-themes.md`, todas via este mesmo
> envelope) — nenhuma delas recalcula nada, só renderiza o que o bloco
> `narratives` do envelope já traz prontinho (banda + cor + valor).

### Sentimento (já um score, não precisa de cálculo aqui)

Vem pronto de `reporting.narratives_overview.net_sentiment` (ver
`foundation/data-model.md`) — score oficial da Brandwatch, -100 a 100.
`get_narratives_table` só repassa o valor do dia mais recente dentro do
`period_start`/`period_end` pedido (não soma nem faz média — `net_sentiment`
já é um score, não uma contagem). Banda (7 faixas) e cor ficam em
`intelligence-center/executive-overview.md`/`_design-tokens.md` — este
módulo não decide cor, só entrega o número.

### Função auxiliar `norm_growth` (reusada por Momentum e Velocidade)

Normaliza uma taxa de crescimento (ilimitada) pra uma escala fixa de 0 a
100, centrada em 50 (crescimento zero = score 50; a mesma fórmula serve
tanto pra Momentum quanto pra Velocidade, só muda o que entra como
`current`/`previous`):

```sql
create or replace function norm_growth(current_value numeric, previous_value numeric)
returns numeric
language sql
immutable
as $$
  select case
    when previous_value is null or previous_value = 0 then 50
    else greatest(0, least(100,
      50 + greatest(least((current_value - previous_value) / previous_value, 1), -1) * 50
    ))
  end
$$;
```

Ou seja: crescimento de +100% (dobrou) ou mais → 100; queda de -100%
(zerou) ou mais → 0; sem crescimento → 50; entre isso, linear. Sem
histórico anterior (`previous_value` nulo/zero) → 50 (neutro/moderado, não
um extremo — não há base pra dizer "cresceu" ou "caiu").

### Momentum (0-100) — força/relevância atual, composta por 4 fatores

"Quão forte e relevante a narrativa está agora" — cresce com volume,
engajamento, autores únicos e alcance, todos comparando o **período
selecionado** (`period_start`/`period_end`, os mesmos 7/14/30 dias da
tela) contra o período imediatamente anterior de igual duração:

```sql
momentum_score = round(
  0.40 * norm_growth(vol_current, vol_previous) +       -- soma de total_mentions no período
  0.25 * norm_growth(engagement_current, engagement_previous) +  -- soma de engagement_total
  0.20 * norm_growth(authors_current, authors_previous) +        -- média de unique_authors no período
  0.15 * norm_growth(reach_current, reach_previous)              -- soma de reach_estimated
)
```

Todos os 4 inputs vêm de `narrative_metrics` (já oficiais/não amostrados,
ver `foundation/data-model.md`) — nenhuma chamada nova à Brandwatch.

| Faixa | Situação |
|---|---|
| 0–19 | Muito baixo |
| 20–39 | Baixo |
| 40–59 | Moderado |
| 60–79 | Alto |
| 80–100 | Explosivo |

### Velocidade (0-100 + rótulo/seta) — taxa de crescimento recente, distinta de Momentum

> Recomendação do usuário (2026-07-13): "separar Momentum de Velocidade —
> Momentum deveria representar a força da narrativa... Velocidade
> representaria sua taxa de crescimento [recente]... evita uma narrativa
> com alto Momentum mas baixa Velocidade (já estabilizou) ser confundida
> com uma de baixo Momentum mas alta Velocidade (tendência emergente)."

Diferente de Momentum (período selecionado na tela), Velocidade é sempre
**curto prazo e independente do filtro de período** — mede se a narrativa
está esquentando ou esfriando *agora*, não no período que o usuário
escolheu olhar:

```sql
-- soma de total_mentions das últimas 3h vs. as 3h imediatamente anteriores,
-- de bw_query_metrics_hourly (grão horário, ver foundation/data-model.md)
velocity_score = norm_growth(total_mentions_last_3h, total_mentions_previous_3h)
```

✅ **Resolvido (2026-07-13)** — usa grão **horário** de verdade
(`bw_query_metrics_hourly`, mesma janela "Últimas 3h vs. 3h anteriores" já
definida em `event-radar/detection-engine.md`, não reimplementada aqui, só
reaproveitada). Antes desta revisão usava fallback diário (último dia vs.
anterior) por falta de grão horário oficial — resolvido junto com o mesmo
gap de `detection-engine.md`, ver `foundation/data-model.md`,
`bw_query_metrics_hourly`.

| Faixa | Rótulo |
|---|---|
| 0–19 | ↓ Encolhendo rapidamente |
| 20–39 | ↘ Diminuindo |
| 40–59 | → Estável |
| 60–79 | ↑ Crescendo |
| 80–100 | ↗ Viralizando |

### Risco (0-100) — prioridade operacional

"Prioridade operacional calculada pela combinação de Sentimento, Momentum,
Velocidade, alcance, influência dos autores e impacto potencial" (definição
do usuário). Composto, sem chamada nova à Brandwatch — reusa Momentum e
Velocidade já calculados acima, mais 3 componentes normalizados para 0-100:

```sql
-- sentiment_risk: inverte net_sentiment (-100..100) pra uma escala de risco (0..100)
sentiment_risk = greatest(0, least(100, (100 - net_sentiment) / 2.0))

-- reach_risk / impact_risk: percentil dentro das Narrativas da MESMA Query no mesmo período
-- (reach/engagement absolutos variam demais entre organizações pra usar um limiar fixo)
reach_risk = reach_estimated * 100.0 / nullif(max(reach_estimated) over (partition by query_id, period), 0)
impact_risk = engagement_total * 100.0 / nullif(max(engagement_total) over (partition by query_id, period), 0)

-- author_influence: % dos top authors da Narrativa (bw_query_top_authors filtrado por
-- category_id) que são is_influential (nativo, followers >= 100k, ver foundation/data-model.md)
author_influence = count(*) filter (where is_influential) * 100.0 / nullif(count(*), 0)

risk_score = round(
  0.25 * sentiment_risk +
  0.25 * momentum_score +
  0.20 * velocity_score +
  0.15 * reach_risk +
  0.10 * author_influence +
  0.05 * impact_risk
)
```

| Faixa | Situação | Cor |
|---:|---|---|
| 0–33 | Baixo | 🟢 verde |
| 34–59 | Moderado | 🟡 amarelo |
| 60–84 | Alto | 🟠 laranja |
| 85–100 | Crítico | 🔴 vermelho |

⚠️ **DECISÃO PENDENTE**: a fórmula acima é uma soma ponderada simples —
uma Narrativa com Momentum/Velocidade altos **e sentimento positivo**
(ex: um vídeo institucional viralizando de forma elogiosa) ainda soma
pontos de risco pelos fatores de Momentum/Velocidade, mesmo não sendo
uma ameaça. Recomendação registrada, não implementada nesta versão: um
termo de interação que amorteça a contribuição de Momentum/Velocidade
quando `sentiment_risk` for baixo (sentimento muito positivo). Fica como
v1 simples (soma ponderada) até o produto confirmar se esse refinamento é
necessário — não travar a implementação por causa disso.

- `narratives.risk_level` (enum manual, `low`/`medium`/`high`/`critical`)
  **continua existindo no schema**, mas deixa de ser o que a coluna Risco
  da tabela mostra por padrão — vira um override manual opcional que uma
  spec futura pode expor (ex: "marcar risco manualmente", sobrepondo o
  score calculado). Não removido, só não é mais a fonte primária da UI.
- Nenhum dos 4 scores (Sentimento/Momentum/Velocidade/Risco) é
  armazenado — todos calculados sob demanda dentro de
  `get_narratives_table`, mesmo padrão de `sov_percent`/`trend_percent` já
  existentes na view.
- `event-radar` (quando existir, Sprint 3): `severity_score` de um evento
  ativo para a Narrativa é conceitualmente próximo de `risk_score` (pesos
  parecidos — volume/sentimento/velocidade/alcance/autores), mas **não**
  os funde num só número — ver
  [../event-radar/severity.md](../event-radar/severity.md), "Relação com
  `risk_score`".

## Regras de negócio

- Granularidade automática da série temporal (`get_volume_trend`): reusa a mesma regra já
  especificada em `foundation/overview.md` para o gráfico de volume do Executive Overview — não
  duplicar a lógica com valores diferentes (ex: "≤7 dias por dia, >31 dias por semana" já existe
  lá; esta function só aplica a mesma regra escolhendo entre `bw_query_metrics_daily`/`weekly`/
  `monthly` conforme o grão resultante, para não recalcular semanas/meses somando dias na mão
  quando o agregado oficial daquele grão já existe).
- Toda function deve respeitar RLS por `organization_id` (nunca confiar apenas no filtro passado
  por parâmetro — a policy de RLS é a garantia real, mesmo padrão de todas as tabelas de
  `foundation`). Para isso valer de fato, **nenhuma function deste módulo é `security definer`**
  — todas rodam com o privilégio de quem chama (`security invoker`, o default do Postgres), e o
  client que a Edge Function usa é autenticado como o usuário real, não a chave secreta — ver
  [edge-functions-per-page.md](edge-functions-per-page.md), "Autenticação do client Supabase".
- `get_narratives_table`/`get_theme_breakdown` aceitam um filtro opcional de `pauta_id`
  (= `narratives.id` de uma Narrativa de topo), para serem reaproveitadas tanto na página
  Narrativas quanto no bloco "narrativas dentro da pauta" em Pautas Eleitorais.
- `get_dissemination_graph` é a única function que recebe um `narrative_id` obrigatório em vez
  de `filters` — ela nunca deve ser chamada para múltiplas narrativas ao mesmo tempo (grafo é
  sempre por narrativa individual, para não gerar payload gigante).
- `get_active_highlights` NUNCA deve reimplementar as regras de detecção do radar (z-score,
  variação %, janelas de comparação). Se um bloco `highlights` parecer "vazio demais" numa
  página, o ajuste é no `event-radar` (thresholds, regras), não uma nova lógica de detecção
  duplicada aqui.

## Dados envolvidos

- **Lê**: `bw_query_metrics_daily`/`weekly`/`monthly`/`hourly` (este último só pro
  `velocity_score` de `get_narratives_table`), `bw_query_metrics_daily_by_platform`,
  `bw_query_topics`, `bw_query_top_authors` (ranking de autores e, via `is_influential`, o
  componente `author_influence` de `risk_score`), `bw_query_top_tweeters`, `narratives`,
  `narrative_metrics`, `bw_categories`, `feed_events`; `mentions` só por-linha, nunca agregada
  (ver "Regra fundamental" acima); `entity_tags` (Sprint 2, quando existir) como enriquecimento
  opcional de `authors`.
- **Escreve**: nenhuma — todas as functions são somente leitura (`STABLE` no Postgres).

## Referências relacionadas

- [overview.md](overview.md)
- [standard-json-envelope.md](standard-json-envelope.md)
- [service-layer-aggregation.md](service-layer-aggregation.md)
- [../foundation/data-model.md](../foundation/data-model.md)
- [../intelligence-center/narratives-exploration.md](../intelligence-center/narratives-exploration.md) — grafo simplificado, mesma fonte
- [../intelligence-center/electoral-themes.md](../intelligence-center/electoral-themes.md) — definição de "Pauta"
