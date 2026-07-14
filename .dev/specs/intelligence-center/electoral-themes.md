---
tipo: feature-spec
módulo: intelligence-center
funcionalidade: electoral-themes
status: implementado
atualizado: 2026-07-22
---

# Pautas Eleitorais

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

- **SOV por pauta**: idêntico ao SOV por Narrativa já especificado
  (`narrative_metrics`/`reporting.narratives_overview`), filtrado às
  Subcategories da Category "Pautas".
- **Evolução temporal por pauta**: idem "Evolução" de
  `narratives-exploration.md`.
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
