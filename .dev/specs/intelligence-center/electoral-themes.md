---
tipo: feature-spec
módulo: intelligence-center
funcionalidade: electoral-themes
status: implementado
atualizado: 2026-07-22
---

# Pautas Eleitorais

> ✅ **SOV da tabela e do gráfico corrigido pra escopo "só Pautas"
> (2026-08-09, mesma sessão do item 4 abaixo)** — pedido do usuário: "tudo
> [nessa página] deve ser somente em cima da categoria Pautas. SOV do
> gráfico e da tabela de narrativas está incorreto. os valores utilizados
> em Share of Voice e sentimento por pauta estão corretos considerando
> apenas as subcategorias de Pautas." Bug real, confirmado lendo as 3
> functions lado a lado: `get_theme_breakdown` ("Share of Voice e
> sentimento por pauta", confirmado correto pelo usuário) já divide as
> menções de cada Pauta pela soma de menções de **todas as Pautas**
> (`grand_total`, migration `20260721030000`) — nunca pelo total da Query
> inteira. `get_narratives_table` (tabela "Narrativas" desta página,
> `p_scope='pautas'`) e `get_theme_sov_trend` (gráfico "SOV por pauta ao
> longo do tempo") faziam diferente: as duas dividiam pelo total da
> **Query inteira** (que inclui toda Narrativa que a organização rastreia,
> não só Pautas) — como Pautas é normalmente um subconjunto pequeno disso,
> os SOVs saíam artificialmente minúsculos (1.2%/0.9%/0.1%/0.1% no
> screenshot do usuário), não por arredondamento, por escopo errado de
> denominador. Corrigido (migration `20260809010000`): as duas passam a
> usar a mesma definição de `get_theme_breakdown` — soma de menções de
> **todas as Subcategories ativas de "Pautas"**, nunca a Query inteira.
> `get_narratives_table` só muda esse comportamento quando `p_scope =
> 'pautas'` — toda outra página (`overview`/`narratives`/`sentiment`)
> mantém o denominador "Query inteira" de sempre, sem mudança. Ver
> `CLAUDE.md` e `aggregated-metrics/sql-aggregation.md` para o
> detalhamento completo.

> ✅ **4 ajustes (2026-08-09)**, pedido do usuário:
> 1. "Share of Voice e sentimento por pauta" (`PautaCardGrid`) ordenado por
>    SOV decrescente — antes vinha na ordem crua de `get_theme_breakdown`
>    (sem `order by` no frontend nem na function). Ordenação só de
>    apresentação (Princípio técnico 2).
> 2-3. Metade inferior da página reorganizada numa grade de 2 colunas:
>    esquerda (`lg:col-span-2`) — tabela interativa "Narrativas" + "Autores
>    e comunidades por pauta"; direita — 3 frames empilhados, nesta ordem:
>    "Comparação entre períodos", "Termos emergentes" (frame reduzido, com
>    scroll interno, `max-h-48 overflow-y-auto`) e "Tópicos positivos e
>    negativos por pauta".
> 4. **Bug real de escopo encontrado e corrigido**: "Insights" (`narrative_text`/
>    `highlights`) nunca foi filtrado às Pautas — `get_active_highlights`/
>    `get_volume_delta` só sabem escopar por `filters.narratives`, e
>    `/themes` nunca setava esse filtro (só `get-narrative-detail` o faz,
>    via `narrativeId`). Na prática, "Insights" desta página sempre mostrou
>    eventos/resumo da **organização inteira**, idêntico a qualquer outra
>    página — nunca restrito ao conteúdo de Pautas Eleitorais, apesar do
>    nome da página. Corrigido em `assemblePageResponse`
>    (`aggregated-metrics-service.ts`): busca as Narrativas-Pauta primeiro
>    (mesma `get_narratives_table(p_scope='pautas')` que já alimenta o
>    bloco `narratives`) e usa os IDs pra escopar `filters.narratives` só
>    nas chamadas de `highlights`/`narrative_text` desta página. Ver
>    `CLAUDE.md` e `aggregated-metrics/sql-aggregation.md`/`ai-synthesis.md`
>    para o detalhamento completo — nenhuma mudança de schema/envelope, só
>    o filtro passado às 2 functions que já suportavam `filters.narratives`.

> Cobre "Página 5 — Pautas Eleitorais" / itens "11. Estrutura das pautas" e
> "12. Visualizações recomendadas" do documento de estrutura do protótipo.
> Sem protótipo interativo correspondente.

> ⚠️ **Escopo corrigido (2026-07-21)**, revertendo o "Achado principal"
> original desta spec (histórico abaixo): "essa página deve focar apenas na
> categoria Pautas. A ideia é que a análise que compõe essa página venha de
> todas as subcategorias de Pautas." O modelo original (qualquer Category
> raiz do Project = uma "Pauta") estava errado — misturava narrativas de
> crise/monitoramento genéricas (ex: "Pesquisas", "Banco Master", ver
> `foundation/brandwatch-setup.md`) com pautas eleitorais de verdade
> (Educação, Saúde, Segurança...). O modelo correto: existe uma Category
> raiz específica na Brandwatch, **nomeada literalmente "Pautas"**
> (convenção de nome, mesmo padrão já usado em todo o projeto pra vincular
> conceito de produto a Category por nomenclatura — ver
> `brandwatch-setup.md` §5), e são as **Subcategories dela** (Educação,
> Saúde, Segurança, Transporte...) que são as pautas eleitorais — nunca
> qualquer outra Category raiz do Project. Ver "Mapeamento de conceito"
> abaixo pro modelo atual.
>
> **Histórico (texto original desta spec, 2026-07-12/16)**: "os exemplos de
> 'pauta' do próprio documento de estrutura (Educação, Saúde, Segurança,
> Transporte...) são exatamente os mesmos nomes usados como exemplo de
> 'Narrativa' no protótipo... não é uma entidade nova, é a mesma entidade
> (`narratives`, ligada a `bw_categories` de topo) vista com outro rótulo de
> produto." — a observação de que "Pauta" = `narratives` continua
> verdadeira; o que mudou é *qual* Category raiz conta como o container das
> pautas (uma específica chamada "Pautas", não qualquer uma).

## Objetivo

Dar uma visão organizada por pauta/tema político (educação, saúde,
segurança, mobilidade etc.) do que está sendo discutido — Share of Voice
por pauta, evolução, sentimento, risco, e os autores/termos ligados a cada
pauta.

## Mapeamento de conceito (decisão de modelagem, não uma tabela nova)

O documento de estrutura descreve duas camadas: "pautas" (Educação, Saúde,
Segurança...) e, dentro de cada uma, "narrativas" mais específicas (ex:
dentro de Saúde → "falta de medicamentos", "tempo de espera", "contratação
de profissionais", "novas unidades", "vacinação"). Na Brandwatch, isso só
cabe em 2 níveis reais (Category → Subcategory, sem nesting mais profundo
— ver `brandwatch-setup.md` §5, "toda Category precisa de ao menos 1
Subcategory"), então o modelo do produto compacta as duas camadas do
documento numa só:

- **Categoria "Pautas"** = uma Category raiz específica na Brandwatch,
  nomeada literalmente "Pautas" (`bw_categories.parent_id is null`,
  `lower(btrim(name)) = 'pautas'`) — resolvida via
  `pautas_root_category_id(organization_id)` (migration `20260721030000`).
  Ela mesma **não** aparece como uma linha em nenhum widget desta página —
  é só o container/convenção que agrupa as pautas reais.
- **Pauta** = `narratives` cujo `bw_category_id` aponta para uma
  **Subcategory da Category "Pautas"** (`bw_categories.parent_id =
  pautas_root_category_id(...)`) — essas são Educação, Saúde, Segurança,
  Transporte etc. Toda Subcategory já vira `narratives` automaticamente
  (`ensureNarrativesFromCategories()`, ver nota histórica abaixo), então
  não precisa de curadoria manual pra aparecer aqui.
- **Narrativa dentro da pauta**: não existe um terceiro nível — uma pauta
  já é uma Subcategory (folha), e a Brandwatch não suporta Subcategory
  dentro de Subcategory. O drill-down "clicar numa pauta e ver as
  narrativas dela" do desenho original não se aplica a este modelo; ver
  "Fluxos alternativos" e `_pending.md` #17 (fechado por não-aplicabilidade,
  não implementado).

✅ **Decidido (2026-07-12)**: "Subcategorias devem virar narrativas. Uma
categoria pode agrupar diversas subcategorias que também são narrativas."
`ensureNarrativesFromCategories()` (módulo `foundation`, `bw-sync/index.ts`)
cria `narratives` a partir de **toda** `bw_categories` (topo e Subcategory),
não só Categories de topo — sem coluna nova em `narratives`: a hierarquia
Category→Subcategory continua 100% derivável via `bw_categories.parent_id`
(join `narratives.bw_category_id → bw_categories.id →
bw_categories.parent_id`).

✅ **Simplificado (2026-07-21)**: o título de uma Narrativa-Subcategory
voltou a ser só o próprio nome (`bw-sync/index.ts`,
`buildNarrativeTitle()`) — a versão "Categoria - Subcategoria" adotada em
2026-07-20 foi revertida no mesmo pedido que corrigiu esta página, porque
toda página do produto agora lista só Narrativas-folha
(`narrativesScopeForPage()`, `'leaves'`/`'pautas'`, nunca mais Category
raiz misturada na mesma lista — ver `narratives-exploration.md`/
`executive-overview.md`), então o prefixo do nome da Category-pai deixou de
resolver alguma ambiguidade real.

## Usuários afetados

Mesmo público das demais páginas deste módulo.

## Fluxo principal

1. Usuário acessa `/themes`, mesmos filtros globais do header.
2. Lista de pautas = Narrativas cujo `bw_category_id` aponta para uma
   Subcategory da Category raiz "Pautas" (`get_theme_breakdown`/
   `get_narratives_table(p_scope => 'pautas')`, migration `20260721030000`)
   — reusa o mesmo componente de tabela/cards de `narratives-exploration.md`,
   sem duplicar. A Category raiz "Pautas" em si nunca aparece como uma
   linha — só serve pra escopar quais Subcategories contam.
   Categories/Subcategories `status = 'inactive'` (removidas da Brandwatch,
   ver `foundation/data-model.md`) nunca aparecem.
3. Sem drill-down "narrativas dentro da pauta": uma pauta já é uma
   Subcategory (folha), e a Brandwatch não suporta um terceiro nível — ver
   "Mapeamento de conceito" acima.
4. "Autores e comunidades por pauta" (`get_authors_ranking(p_scope =>
   'pautas')`) mostra só autores com atividade em alguma Subcategory de
   "Pautas" — nunca o ranking genérico da Query inteira — e cada autor
   carrega `narrative_labels`: os títulos de todas as pautas em que ele
   apareceu no período (pode ser mais de uma).
5. Comparação entre períodos (ex: "Segurança perdeu 4 pontos de
   participação, enquanto saúde ganhou 7 pontos na última semana") — cálculo
   simples de diferença de SOV entre dois períodos já agregados
   oficialmente (`narrative_metrics` de duas janelas), não uma nova fonte
   de dado.

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Nenhuma Category raiz chamada "Pautas" configurada na Brandwatch ainda (ou nome diferente) | `pautas_root_category_id()` retorna `null` → todo bloco desta página (`breakdowns`/`narratives`/`authors`) fica vazio, mesmo `<EmptyState />` de "Nenhuma Narrativa em monitoramento" (`executive-overview.md`) — a causa raiz é distinguível pelo nome específico da mensagem em cada widget (ver `themes/page.tsx`) |
| Category "Pautas" existe mas sem nenhuma Subcategory ativa | Mesmo `<EmptyState />` acima — Brandwatch já exige ≥1 Subcategory por Category (`brandwatch-setup.md` §5), então esse caso só ocorre se todas foram desativadas (`status = 'inactive'`) |
| Nenhum autor citou uma pauta no período | "Autores e comunidades por pauta" mostra `<EmptyState />` textual, não erro |

## Interface (UI)

- **SOV por pauta**: ⚠️ **Definição corrigida (2026-08-09)** — o texto
  original desta spec ("idêntico ao SOV por Narrativa... filtrado às
  Subcategories de Pautas") descrevia, sem perceber, o próprio bug: SOV
  filtrado a **quais linhas aparecem** na tela, mas ainda dividido pelo
  total da **Query inteira** (todas as Narrativas rastreadas, não só
  Pautas) — resultado, percentuais artificialmente pequenos (ver
  blockquote de topo). Definição correta, em vigor desde a migration
  `20260809010000`: SOV de uma Pauta = suas menções no período / soma das
  menções de **todas as Subcategories ativas de "Pautas"** no mesmo
  período — a mesma base que `get_theme_breakdown` ("Share of Voice e
  sentimento por pauta") já usava. `get_narratives_table` (tabela
  "Narrativas") e `get_theme_sov_trend` (gráfico "SOV por pauta ao longo
  do tempo") calculam essa mesma base cada uma à sua maneira: a primeira
  soma o período pedido inteiro (`pautas_period_total`); a segunda soma
  por bucket (dia/semana/mês/hora), já que é uma série temporal — ambas
  cobertas pela mesma migration. ✅ **Ordenado decrescente (2026-08-09)**
  — `PautaCardGrid` (`components/intelligence-center/pauta-cards.tsx`)
  agora ordena os itens por `pct` (SOV) decrescente antes de renderizar.
- **Evolução temporal por pauta**: idem "Evolução" de
  `narratives-exploration.md`. ✅ **Grão `hour` para o modo "Diário"
  (2026-08-09)** — pedido do usuário: "a linha do tempo está ficando
  vazia quando o período é diário. Nesse caso precisa mostrar por hora."
  `get_theme_sov_trend` caía no grão `day` mesmo em "Diário" (1 dia),
  devolvendo 1 único ponto por Pauta — na prática um gráfico vazio, mesmo
  bug já corrigido em `get_volume_trend` (2026-07-19), que
  `get_theme_sov_trend` nunca tinha ganhado (só existe desde 2026-07-25,
  já criada sem esse grão). Ver `sql-aggregation.md` pro detalhamento —
  sem mudança de frontend, `TrendLineChart` já distingue hora/dia
  genericamente pelo formato do `bucket_date`.
  ⚠️ **Continuava vazio mesmo depois desse fix — causa raiz real era em
  `bw-sync`, não no SQL (2026-08-09, mesma sessão)**: `bw_query_metrics_hourly`
  nunca gravou `total_mentions` de verdade pra nenhuma Narrativa/Pauta
  (`category_id` não-nulo) — só a linha da Query inteira (`category_id is
  null`) recebia esse campo; a função que grava por Narrativa
  (`syncHourlyNetSentiment`) só escrevia `net_sentiment`. O SQL do gráfico
  estava certo, o dado que ele lê nunca existiu. Corrigido em `bw-sync/index.ts`
  (`syncHourlySentimentMetrics` ganhou um parâmetro `categoryId`,
  `runHourlyMetricsStep` ganhou um loop throttled por Narrativa) — ver
  `foundation/data-model.md`, `bw_query_metrics_hourly`, e `CLAUDE.md` pro
  detalhamento completo.
- **Dot de cor no card de Pauta** ("Share of Voice e sentimento por
  pauta"): ✅ **Recolorido pra bater com a linha do gráfico (2026-08-09)**
  — pedido do usuário: "pinte a bolinha que existe ao lado das pautas com
  a cor do gráfico de linhas para facilitar a leitura." Antes o dot usava
  `NetSentimentDot` (cor por sentimento); agora usa `colorForGroup(item.label)`
  (`lib/chart-colors.ts`, extraída de `trend-line-chart.tsx` pra ser
  reusada aqui) — a mesma função que colore cada série de "SOV por pauta
  ao longo do tempo", então a cor do card sempre bate com a linha
  correspondente no gráfico logo abaixo. Sentimento deixa de ter
  representação visual neste card específico (só na tabela "Narrativas" e
  no widget "Sentimento por pauta") — trade-off aceito, pedido explícito e
  literal do usuário.
- **Sentimento por pauta**: idêntico a "Sentimento por Narrativa" de
  `sentiment-analysis.md` — sem gap adicional, mesmo escopo de pautas.
- **Risco por pauta** (matriz volume × negatividade × momentum × alcance ×
  risco): todos os campos de entrada já existem em `narrative_metrics` — é
  uma visualização nova (matriz/scatter) sobre dado já disponível, sem gap
  de captura. ✅ **Resolvido (2026-07-13)**: fórmulas de `momentum_score`/
  `trend_score` (antes `velocity_score` — ver nota de 2026-07-22 em
  `sql-aggregation.md`, "Tendência")/`risk_score` definidas em
  [../aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md),
  "Scores de Narrativa" — esta página reusa `get_narratives_table()`
  filtrado às pautas, não inventa um cálculo novo.
- **Plataforma por pauta**: idêntico a `bw_query_metrics_daily_by_platform`
  filtrado por `category_id` da pauta — sem gap.
- **Autores e comunidades por pauta**: `get_authors_ranking(p_scope =>
  'pautas')` — só autores que citaram alguma pauta, cada um com
  `narrative_labels` (a quais pautas está associado, pode ser mais de uma).
  ✅ **Resolvido (2026-07-21)**: antes desta correção, este widget não
  escopava a authors_ranking a nenhuma Category (`filters.narratives` vazio
  → escopo "Query inteira"), então mostrava o mesmo ranking genérico de
  qualquer outra página, sem relação real com Pautas. Sem a classificação
  de papel do autor (imprensa/especialista/influenciador/movimento/
  cidadão/perfil político) pedida no texto original: essa classificação
  **não é dado da Brandwatch** e está listada em `_index.md` como
  explicitamente fora de escopo do MVP ("Clusterização semântica por IA e
  classificação de papel do autor"). Mostrar só o que já existe
  (`account_type` nativo da Brandwatch, quando presente), sem inventar a
  taxonomia própria.
  ✅ **Sentimento por autor corrigido (2026-08-09)** — usuário reportou:
  "a tabela só aparece sentimento para um author, pq não aparece para os
  demais?" Causa raiz: sentimento por autor só existe pra quem já foi
  enriquecido via `bw_query_author_topics`, e o único pool de
  enriquecimento sempre foi "top 10 autores por volume da QUERY INTEIRA"
  (`bw-sync`'s `runAuthorEnrichmentStep`) — nunca escopado por Pauta. Como
  Pautas é um subconjunto pequeno do que a Query inteira rastreia, o pool
  global e "autores ativos em Pautas" são majoritariamente disjuntos; só
  quem cai nos dois (coincidência) mostrava sentimento aqui. Fix: segundo
  pool de candidatos — top 10 autores por volume somado entre as
  Subcategories de "Pautas" (`bw_pautas_top_author_candidates`, migration
  `20260809030000`) — ver `foundation/sync-brandwatch.md`/
  `aggregated-metrics/sql-aggregation.md` pro detalhamento completo.
  ✅ **Colunas ajustadas (2026-08-09)** — pedido do usuário: "substitua a
  coluna Partido por tipo de entidade... Retire da tabela o campo
  ideologia." `AuthorsList`'s variant `full` (único consumidor: esta
  página) trocou de Autor/Partido/Ideologia/Menções/Alcance/Engaj./
  Sentimento pra Autor/Tipo/Menções/Alcance/Engaj./Sentimento — "Tipo"
  (`entity_type`) só preenche quando o autor tem vínculo real com uma
  Entity, `—` sem vínculo (mesmo padrão já usado pela guia "Por Entidade"
  de `/authors`).
- **Termos emergentes**: de `bw_query_topics` filtrado por `category_id` da
  pauta, ordenado por `trending` desc — sem gap. ✅ **Ganhou "Tópicos
  positivos por pauta"/"Tópicos negativos por pauta" (2026-07-14)** —
  pedido do usuário ("em todas as páginas é importante existir os
  principais tópicos positivos e negativos"), mesmo `term_signals` já
  buscado para "Termos emergentes", só separado por polaridade — sem
  chamada adicional. ✅ **Unificado num único frame (2026-07-14, mesma
  sessão)** — pedido seguinte: "no mesmo frame mudando apenas a cor".
  "Tópicos positivos por pauta"/"Tópicos negativos por pauta" (2
  `WidgetCard`s separados) viraram um único "Tópicos positivos e
  negativos por pauta" (`TopicSentimentList`), pills coloridas por
  sentimento (verde/vermelho/neutro) na mesma lista.
- **Comparação entre períodos**: ver "Fluxo principal" item 5.
- **Insights** (`narrative_text`/`highlights`): ✅ **Escopo corrigido
  (2026-08-09)** — antes lia a organização inteira (bug real, ver
  blockquote de topo); agora `assemblePageResponse` escopa
  `filters.narratives` aos IDs das Narrativas-Pauta antes de chamar
  `get_active_highlights`/`get_volume_delta`, então o resumo/lista de
  eventos desta página passa a cobrir só eventos com `related_narrative_id`
  numa Pauta. Sem gap se a organização não tiver nenhuma Subcategory sob
  "Pautas" configurada — nesse caso cai de volta pro escopo antigo
  (limitação aceita, ver comentário em `assemblePageResponse`).

## Regras de negócio

- Nenhum cálculo local sobre `mentions` — mesma regra de todas as páginas
  deste módulo.
- "Pauta" não é uma tabela nova — é `narratives` filtrado por
  `bw_category_id` apontando a uma Subcategory da Category raiz "Pautas"
  (`pautas_root_category_id`, resolvida por nome). Nenhuma migration de
  schema nova necessária além da já existente em `bw_categories`/`narratives`
  — só funções SQL (migration `20260721030000`).
- A Category raiz "Pautas" é identificada por convenção de nome
  (case/espaço-insensitive), não por uma coluna/flag dedicada — mesmo
  padrão já usado no projeto pra vincular `narratives.title` a uma Category
  por nomenclatura (`brandwatch-setup.md` §5). Se o analista renomear essa
  Category na Brandwatch, a página para de encontrá-la até o nome ser
  corrigido — comportamento aceito, sem UI de configuração pra apontar
  qual Category é "a de Pautas" neste MVP.

## Dados envolvidos

- **Lê**: `narratives` (+ `bw_category_id`/`bw_categories.parent_id`/`name`
  para resolver a Category "Pautas" e suas Subcategories),
  `narrative_metrics`, `bw_query_metrics_daily_by_platform`,
  `bw_query_top_authors`, `bw_query_top_tweeters`,
  `bw_query_author_topics`, `bw_query_topics`.
- Nenhuma escrita nesta versão — `narratives` é auto-seedada por
  `ensureNarrativesFromCategories()` (`bw-sync`), sem CRUD manual.

## Permissões

Mesma tabela de `executive-overview.md`.

## Referências relacionadas

- [intelligence-center/overview.md](overview.md)
- [intelligence-center/narratives-exploration.md](narratives-exploration.md)
- [intelligence-center/sentiment-analysis.md](sentiment-analysis.md)
- [foundation/data-model.md](../foundation/data-model.md)
- [_index.md](../_index.md) — "Fora de escopo do MVP" (classificação de papel do autor, clusterização por IA)
