---
tipo: feature-spec
módulo: aggregated-metrics
funcionalidade: standard-json-envelope
status: implementado
atualizado: 2026-08-08
---

# Contrato do Envelope JSON (formato único de resposta de página)

> ✅ **Implementado (2026-07-14/22)**: `@reputation/shared-types`
> (`packages/shared-types/src/envelope.ts`) é o tipo TS canônico deste
> contrato no lado Next.js; `supabase/functions-shared-source/
> aggregated-metrics-service.ts` mantém a cópia inline usada pelas 6 Edge
> Functions (Princípio técnico 5 impede importar o pacote de workspace em
> produção — ver `_pending.md`, decisão #2 resolvida). Todas as 6 Edge
> Functions (`get-page-*`/`get-narrative-detail`) já retornam este envelope
> exatamente na forma descrita abaixo, incluindo os campos evoluídos desde
> a versão original (`x_insights`, `trend_score`/`trend_label` no lugar de
> `velocity_score`/`velocity_label`). Único campo que nunca é preenchido
> hoje: `narrative_text` — fica sempre `null` (nem o template Camada 0 de
> `ai-synthesis.md` está implementado ainda, ver nota nesse arquivo).
> ⚠️ Nota desatualizada desde 2026-07-25/2026-08-02 — `narrative_text`
> (Camadas 0 e 1 de `ai-synthesis.md`) está implementado e populado de
> verdade; ver esse arquivo pro estado real.

> ✅ **`period.mode` adicionado (2026-07-14)** — pedido do usuário: o
> resumo executivo gerado por IA (`narrative_text`, `ai-synthesis.md`)
> deve diferenciar diário/semanal/mensal (já verdade por construção, já
> que cada modo produz `period.start`/`end` distintos — cada um cai numa
> chave própria em `page_narrative_synthesis`) e, "em caso de período
> personalizado", só chamar a IA sob pedido explícito do usuário, nunca
> sozinho. `period.mode` (`"daily" | "weekly" | "monthly" | "custom"`,
> opcional, espelha `PeriodMode` do seletor do header —
> `header-context.tsx`) é o campo que carrega essa informação até o
> backend; nenhuma function SQL o lê, só `fetchNarrativeText()`
> (`aggregated-metrics-service.ts`) — ver `ai-synthesis.md`.

## Objetivo

Definir um único formato de JSON que TODAS as Edge Functions de página devem retornar, para que
o frontend renderize a partir dele e a IA gere o texto explicativo a partir do mesmo objeto, sem
transformação intermediária.

## Regra fundamental

> ⚠️ O sistema NUNCA deve criar um formato de JSON diferente por página. Toda página retorna o
> mesmo envelope (definido abaixo). O que muda de página para página é **quais blocos vêm
> preenchidos** e com **quais filtros**, nunca a estrutura em si.

## Estrutura do envelope

O sistema deve implementar o envelope com exatamente estes campos de topo. Nomes de campo em
inglês, como o resto do schema do projeto (ver nota de nomenclatura em `_index.md`) — só rótulos
exibidos na UI ficam em português:

```json
{
  "schema_version": "1.0",
  "page": "overview",
  "organization_id": "uuid",
  "period": {
    "start": "2026-06-01",
    "end": "2026-06-30",
    "granularity": "day",
    "comparison": "previous_period",
    "mode": "monthly"
  },
  "filters_applied": {
    "narratives": [],
    "themes": [],
    "platforms": [],
    "sentiment": [],
    "region": [],
    "author_type": [],
    "risk_level": []
  },
  "generated_at": "2026-07-12T14:00:00Z",

  "metrics": [],
  "breakdowns": [],
  "trends": [],
  "narratives": [],
  "authors": [],
  "highlights": [],
  "term_signals": [],
  "graph": null,
  "x_insights": [],

  "narrative_text": null,
  "ui_meta": {}
}
```

`page` usa os mesmos slugs de rota definidos em `overview.md` ("Rotas/Páginas"): `overview`,
`narratives`, `narrative_detail`, `sentiment`, `platforms`, `themes`, `authors`, `alerts`,
`reports`. 📝 **`reports_custom` planejado (2026-07-17, spec do módulo `executive-reports`, ainda
não implementado)** — segundo page key desta página, para `/reports/custom` (Relatório
Personalizado); `reports` continua sendo `/reports/executive` (Relatório Executivo) — ver
[executive-reports/overview.md](../executive-reports/overview.md).

## Descrição de cada bloco

- **`metrics`**: cards de KPI (ex: total de menções, autores únicos, alcance). Cada item deve ter
  `key`, `label`, `value`, `unit`, `delta_pct`, `trend` (`up`/`down`/`stable`), e opcionalmente
  `sparkline` (série curta para mini-gráfico).
- **`breakdowns`**: composições percentuais de um eixo (sentimento, plataforma, pauta, região).
  Cada item tem `key`, `type` (`sentiment`|`platform`|`theme`|`region`), e `items: [{label,
  value, pct}]`.
- **`trends`**: séries temporais. Cada item tem `key`, `label`, e `series: [{date, value}]`. Uma
  série pode ter múltiplas linhas (ex: total/positivo/neutro/negativo) — nesse caso, usar
  `series_by_group: [{group, series}]`.
- **`narratives`**: a tabela de narrativas (usada na Visão Geral, na página Narrativas e dentro
  de Pautas Eleitorais, sempre com filtro diferente). ✅ **Campos atualizados 2026-07-13** (ver
  `aggregated-metrics/sql-aggregation.md`, "Scores de Narrativa", fonte de verdade dos cálculos):
  `id`, `title`, `sov_pct`, `total_mentions`,
  `net_sentiment` (número, -100 a 100) + `sentiment_label` (`very_positive`|`positive`|
  `slightly_positive`|`neutral`|`slightly_negative`|`negative`|`very_negative`),
  `momentum_score` (0-100), `trend_score` (0-100) + `trend_label`
  (`decreasing`|`stable`|`increasing`),
  `risk_score` (0-100) + `risk_label` (`low`|`medium`|`high`|`critical`) — mesmos nomes de campo
  usados por `reporting.narratives_overview`/`get_narratives_table()` (ver
  `foundation/data-model.md`/`aggregated-metrics/sql-aggregation.md`), este bloco não inventa um
  segundo vocabulário para a mesma tabela. Campo `trend`/`risk_level` (versão anterior deste
  bloco) foram substituídos por `velocity_label`/`risk_label` (2026-07-13) — ver nota de migração
  em `sql-aggregation.md`. ✅ **`velocity_score`/`velocity_label` renomeados para
  `trend_score`/`trend_label` (2026-07-22, migration `20260722010000`)** — mesmo campo/posição no
  envelope, só troca de nome/método (regressão estatística em vez de snapshot 3h-vs-3h) e de
  cardinalidade do rótulo (3 valores em vez de 5) — ver `sql-aggregation.md`, "Tendência".
  ✅ **`positive_topics`/`negative_topics` adicionados (2026-07-14, migration `20260805010000`)**
  — `text[]`, até 5 termos/hashtags cada (mesmo universo de `tags`, `bw_query_topics`), cujo
  sentimento predominante (mesma classificação por maioria de `get_term_signals`) é positivo/
  negativo. Sempre array, nunca `null`. Mapeamento tópico↔Narrativa por polaridade — pedido do
  usuário para que a IA (`narrative_summary_build_payload`) e o usuário final (card de Narrativa)
  vejam quais termos específicos puxam o sentimento de cada Narrativa, não só a lista neutra de
  `tags` — ver `sql-aggregation.md`, "Mapeamento tópico↔Narrativa por polaridade".
- **`authors`**: ranking de autores/influenciadores. Cada item tem `entity_id` (nulo até
  `entities`, Sprint 2, existir e enriquecer — o ranking em si não depende disso, ver
  `sql-aggregation.md`), `name`, `type`, `reach`, `engagement`, `risk_level`,
  `is_influential` (nativo de `bw_query_top_authors`, ver `foundation/data-model.md`).
  `centralidade`/`recorrencia`/`capacidade_amplificacao` da versão anterior deste bloco não têm
  agregado oficial da Brandwatch nem cálculo local aprovado — retirados até existir fonte
  concreta (mesma premissa de não estimar sobre `mentions` amostrada). ⚠️ **Correção de drift de
  documentação (2026-07-13)**: este parágrafo não listava dois campos que já existem na
  implementação real (`AuthorRow`, `packages/shared-types/src/envelope.ts`) desde sessões
  anteriores — `sentiment_positive`/`sentiment_neutral`/`sentiment_negative` (nullable, só os top
  10 autores enriquecidos via `bw_query_author_topics` têm valor — ver `sql-aggregation.md`,
  `get_authors_ranking`, achado de 2026-07-17) e `narrative_labels` (`string[]`, sempre presente,
  título das Narrativas/pautas em que o autor teve atividade no escopo pedido — ver
  `get_authors_ranking`, `p_scope`, 2026-07-21). Nenhuma mudança de comportamento, só a spec
  alcançando o código. ✅ **`entities` implementado (2026-08-01)** — ver
  [entities/author-linking.md](../entities/author-linking.md) e
  [intelligence-center/authors-and-influencers.md](../intelligence-center/authors-and-influencers.md),
  "Redesenho interativo" — este bloco ganha 7 campos aditivos: `entity_type`
  (`entities.type`, `null` sem vínculo), `entity_cargo`/`entity_partido`/`entity_ideologia`
  (`entities.cargo`/`partido`/`ideologia`, `null` sem vínculo — colunas estruturadas, não
  `entity_tags`), `entity_influence_level` (`entities.influence_level`, `null` sem vínculo ou sem
  avaliação), `entity_tags` (array de `{tag_type, tag_value}`, `[]` sem vínculo — formato
  genérico de propósito, espelha `entity_tags` linha a linha só pras dimensões que continuam EAV
  — `state`/`power_branch`/`stance_to_candidate` — já que essa taxonomia é extensível por design),
  e `mentions` (`number`, nunca nulo — soma de menções do autor, existia internamente na function
  desde sempre só pra ordenar o ranking, nunca tinha sido exposta ao client).
  ✅ **2 campos aditivos a mais (2026-08-08)**, widget "Quem move a conversa" (ver
  `intelligence-center/narratives-exploration.md`, "Formação e propagação"): `followers`
  (`number | null`, `bw_query_top_authors`/`top_tweeters.followers`, `max()` entre categorias — não
  soma, ver `sql-aggregation.md`) e `platforms` (`string[]`, sempre presente — pode ser `[]` — só
  reporta uma plataforma quando há sinal real em `platform_stats`, nunca fabricada).
- **`highlights`**: cards de evento já publicados pelo módulo `event-radar`, lidos direto de
  `feed_events` — este bloco NUNCA recalcula insight, apenas filtra e ordena o que o radar já
  publicou (ver seção "Integração com event-radar" abaixo). Cada item usa o mesmo formato de
  saída do agent do radar: `event_type`, `severity` (`low`|`medium`|`high`|`critical`),
  `severity_score`, `title` (≤90 caracteres), `summary` (≤300 caracteres), `explanation`,
  `recommendation` (quando aplicável), `confidence`, `tags`, `related_narrative_id`/
  `related_entity_id`, e (✅ 2026-07-14) `created_at` (`feed_events.created_at`) — usado por
  `ai-synthesis.md` pra detectar "evento novo desde a última composição da Camada 1", não é
  exibido em nenhum componente de UI hoje. Itens de uma página são os N mais severos dentro
  do escopo/filtro daquela página, já dentro do cap diário aplicado pelo radar.
- **`term_signals`**: termos/temas emergentes ou "drivers" de sentimento — de `bw_query_topics`,
  ver `sql-aggregation.md`. Cada item tem `term`, `growth_pct`, `volume`, `sentiment_associated`.
  ✅ **`volume` adicionado (2026-08-09, migration `20260809130000`)** — menções absolutas do
  termo, sempre presente independente de qual perspectiva (`TopicSortMode` — `'trending'`/
  `'volume'`, ver `PageContext.topicSort` em `service-layer-aggregation.md`) decidiu o
  corte/ordem do conjunto retornado por `get_term_signals`. Default da perspectiva: `'trending'`
  em toda a cadeia (SQL e TS).
  ✅ **Estendido a `overview`/`narratives`/`platforms` (2026-07-14)** — antes só preenchido em
  `sentiment`/`themes`/`narrative_detail`; pedido do usuário ("em todas as páginas é importante
  existir os principais tópicos positivos e negativos"). Ver `block-mapping-per-page.md`.
- **`graph`**: grafo de disseminação simplificado — só preenchido na página de detalhamento de
  narrativa, mesma fonte e mesma rotulagem de "amostra das mentions sincronizadas" já decidida em
  `intelligence-center/narratives-exploration.md` (não um novo cálculo). Formato:
  `{ "nodes": [{id, label, reach}], "edges": [{source, target, type}] }`, onde `type` da aresta é
  `reply`|`retweet`|`mention` — os três tipos de relacionamento que `mentions.reply_to`/
  `retweet_of`/`insights_mentioned` de fato capturam (ver `sql-aggregation.md`,
  `get_dissemination_graph`). Não inventar tipos de nó/aresta sem fonte de dado real.
- **`x_insights`**: ✅ **Adicionado 2026-07-18** — "X Themes" nativo da Brandwatch (Top Hashtags/Top
  Emojis/Top Stories/Most Mentioned X Posters), só preenchido na página `authors` (moveu de
  `platforms` para `authors` em 2026-07-25, ver `block-mapping-per-page.md`). Cada item tem `insight_type`
  (`hashtag`|`emoticon`|`url`|`mentioned_author`), `name`, `label` (só relevante para
  `emoticon` — descrição textual do emoji), `volume`, `tweets`, `retweets`, `impressions`,
  `reach_estimate` — de `bw_query_x_insights`, ver `sql-aggregation.md`, `get_x_insights`.
  ✅ **`synced_at` adicionado (2026-08-03)** — `timestamptz` da última sincronização daquele
  item (nunca `null`), pra o frontend mostrar frescor ("Atualizado há N dias") em vez de um
  número sem contexto temporal — `bw-sync` só re-sincroniza X Insights a cada 7 dias por par
  (`isXInsightsStale`), ver `sql-aggregation.md` pra a auditoria completa que motivou isso.
- **`narrative_text`**: texto gerado pela IA a partir deste mesmo envelope (ver
  [ai-synthesis.md](ai-synthesis.md)). Fica `null` até a síntese rodar; depois é armazenado em cache
  junto do envelope.
- **`ui_meta`**: qualquer dado que serve só para renderização (cores de gráfico, cursor de
  paginação, ids técnicos de UI). Este bloco NUNCA deve ser enviado para a IA.
  ✅ **4 chaves de texto Camada 2 adicionadas (2026-07-14)**, ver `ai-synthesis.md`: `featured_content_text`
  (só `platforms`), `period_comparison_text` (só `themes`), `authors_overview_text` (só
  `authors`), `narratives_overview_text` (só `narratives`, adicionado na sessão seguinte) — cada
  uma um parágrafo curto gerado por IA a partir de dado já agregado da própria página, sem
  equivalente no radar. `null`/ausente em toda outra página.

## Regras de negócio

- ⚠️ **`query_id` NÃO é campo do envelope — revertido 2026-07-13**. Uma versão anterior desta
  spec adicionou `query_id` como campo de topo (pra "uma organização pode ter 1+ Queries").
  Corrigido pelo usuário no mesmo dia: "o seletor de organização é independente de Query... as
  Queries devem ser transparentes para o usuário final, ele só entende organização". `query_id`
  nunca chega do client — cada function SQL resolve internamente todas as Queries da
  `organization_id` recebida (via `bw_queries.project_id → bw_projects.organization_id`) e
  combina os dados (soma pra métricas agregadas, união pra listas como `narratives`, cada linha
  mantendo seu próprio `query_id` internamente só pra cálculo correto de SOV — nunca exposto no
  payload de resposta). Ver `aggregated-metrics/sql-aggregation.md`, "Functions a implementar".
- Toda página deve retornar os 9 campos de topo (`metrics` até `x_insights`), mesmo que vazios
  (`[]` ou `null`) — o Claude Code não deve omitir chaves não usadas por uma página específica.
  Isso mantém o parser do frontend e o prompt da IA únicos para todas as páginas.
- `schema_version` deve ser incrementado sempre que um bloco mudar de formato (não ao adicionar
  itens novos dentro de um array — apenas ao mudar a forma dos campos existentes).
- `filters_applied` e `period` devem sempre refletir exatamente o que veio do header global,
  nunca um valor calculado internamente pela Edge Function.
- Ao montar o payload para a IA (ver `ai-synthesis.md`), o sistema deve remover `ui_meta` e
  `narrative_text` antes de enviar — o restante do objeto vai inteiro.

## Dados envolvidos

Este envelope não é uma tabela — é a forma de saída. Ver
[sql-aggregation.md](sql-aggregation.md) para a origem de cada bloco.

## Integração com event-radar

> ⚠️ O Claude Code deve implementar `event-radar` (motor de detecção + orquestrador de IA por
> evento) ANTES ou em conjunto com este módulo. `highlights` e `narrative_text` dependem
> diretamente da tabela `feed_events` populada pelo radar — sem o radar, esses dois blocos ficam
> sempre vazios.

- `highlights` = leitura filtrada de `feed_events` (tipo/tag `"radar"`, ver
  `event-radar/schema-integration.md`). Nenhuma lógica de detecção ou de IA nova acontece neste
  módulo.
- `narrative_text` reaproveita os campos `summary`/`explanation` dos highlights daquela página
  em vez de gerar uma análise nova. Ver [ai-synthesis.md](ai-synthesis.md) para o fluxo completo.
- ✅ **Atualizado 2026-07-13**: `narratives[].risk_score` (não mais `momentum_score`) é o campo
  que se beneficia de um evento ativo do radar — `risk_score = greatest(risk_score calculado,
  severity_score do evento ativo)`, quando existir. `momentum_score`/`trend_score` (antes
  `velocity_score`, ver nota de 2026-07-22 acima) são 100% estatísticos (SQL, sem IA) e nunca
  dependem de `event-radar` estar publicando — ver [sql-aggregation.md](sql-aggregation.md),
  "Scores de Narrativa".

## Referências relacionadas

- [overview.md](overview.md)
- [sql-aggregation.md](sql-aggregation.md)
- [service-layer-aggregation.md](service-layer-aggregation.md)
- [edge-functions-per-page.md](edge-functions-per-page.md)
- [ai-synthesis.md](ai-synthesis.md)
- [../foundation/data-model.md](../foundation/data-model.md) — tabelas de origem reais
