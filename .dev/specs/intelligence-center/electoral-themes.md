---
tipo: feature-spec
módulo: intelligence-center
funcionalidade: electoral-themes
status: pronto
atualizado: 2026-07-12
---

# Pautas Eleitorais

> Cobre "Página 5 — Pautas Eleitorais" / itens "11. Estrutura das pautas" e
> "12. Visualizações recomendadas" do documento de estrutura do protótipo.
> Sem protótipo interativo correspondente. **Achado principal desta spec**:
> os exemplos de "pauta" do próprio documento de estrutura (Educação, Saúde,
> Segurança, Transporte...) são **exatamente** os mesmos nomes usados como
> exemplo de "Narrativa" no protótipo `Comunicacao Inteligente.dc.html`
> (`Transporte Público`, `Saúde`, `Educação`, `Segurança`...) — não é uma
> entidade nova, é a mesma entidade (`narratives`, ligada a
> `bw_categories` de topo) vista com outro rótulo de produto.

## Objetivo

Dar uma visão organizada por pauta/tema político (educação, saúde,
segurança, mobilidade etc.) do que está sendo discutido — Share of Voice
por pauta, evolução, sentimento, risco, e as Narrativas mais específicas
dentro de cada pauta.

## Mapeamento de conceito (decisão de modelagem, não uma tabela nova)

O documento de estrutura descreve duas camadas: "pautas" (Educação, Saúde,
Segurança...) e, dentro de cada uma, "narrativas" mais específicas (ex:
dentro de Saúde → "falta de medicamentos", "tempo de espera", "contratação
de profissionais", "novas unidades", "vacinação"). Isso bate exatamente com
a hierarquia que já existe em `bw_categories` (`parent_id` — Category raiz
= sem `parent_id`, Subcategories = filhas) e com o auto-seed de
`narratives` a partir de Categories de topo, já implementado
(`ensureNarrativesFromCategories()`, ver `CLAUDE.md` "Narratives auto-seed
from top-level Categories"):

- **Pauta** = `narratives` cujo `bw_category_id` aponta para uma
  `bw_categories` **raiz** (`parent_id is null`) — já existe, sem trabalho
  novo.
- **Narrativa dentro da pauta** = Subcategory (`bw_categories.parent_id`
  apontando para a Category raiz da pauta) — **hoje não é auto-criada como
  `narratives`** (`ensureNarrativesFromCategories()` só cobre Categories de
  topo; Subcategories foram deixadas "para curadoria manual", ver
  `CLAUDE.md`).

✅ **Decidido (2026-07-12)**: "Subcategorias devem virar narrativas. Uma
categoria pode agrupar diversas subcategorias que também são narrativas."
`ensureNarrativesFromCategories()` (módulo `foundation`, `bw-sync/index.ts`)
foi alterada para criar `narratives` a partir de **toda** `bw_categories`
(topo e Subcategory), não só Categories de topo — sem coluna nova em
`narratives`: a hierarquia Pauta→Narrativa-filha continua 100% derivável
via `bw_categories.parent_id` (join `narratives.bw_category_id →
bw_categories.id → bw_categories.parent_id`). Esta página já pode mostrar
"Narrativas dentro de cada pauta" com dado real assim que o próximo sync
de metadata rodar — sem esperar curadoria manual.

## Usuários afetados

Mesmo público das demais páginas deste módulo.

## Fluxo principal

1. Usuário acessa `/themes`, mesmos filtros globais do header.
2. Lista de pautas = Narrativas com `bw_category_id` apontando para uma
   Category raiz — reusa o mesmo componente de tabela/cards de
   `narratives-exploration.md`, sem duplicar.
3. Ao expandir uma pauta, mostrar (se existirem) as Narrativas-filhas
   (Subcategories curadas como `narratives`) — ver decisão pendente acima.
4. Comparação entre períodos (ex: "Segurança perdeu 4 pontos de
   participação, enquanto saúde ganhou 7 pontos na última semana") — cálculo
   simples de diferença de SOV entre dois períodos já agregados
   oficialmente (`narrative_metrics` de duas janelas), não uma nova fonte
   de dado.

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Nenhuma Category raiz configurada na Brandwatch ainda | Mesmo `<EmptyState />` de "Nenhuma Narrativa em monitoramento" (`executive-overview.md`) — a causa raiz é a mesma (`bw_categories` vazio) |
| Pauta sem nenhuma Subcategory curada como Narrativa | Seção "Narrativas dentro da pauta" mostra `<EmptyState />` textual, não erro |

## Interface (UI)

- **SOV por pauta**: idêntico ao SOV por Narrativa já especificado
  (`narrative_metrics`/`reporting.narratives_overview`), filtrado a
  Narrativas de topo.
- **Evolução temporal por pauta**: idem "Evolução" de
  `narratives-exploration.md`.
- **Sentimento por pauta**: idêntico a "Sentimento por Narrativa" de
  `sentiment-analysis.md` — sem gap adicional, é a mesma Narrativa de topo.
- **Risco por pauta** (matriz volume × negatividade × momentum × alcance ×
  risco): todos os campos de entrada já existem em `narrative_metrics` — é
  uma visualização nova (matriz/scatter) sobre dado já disponível, sem gap
  de captura. ✅ **Resolvido (2026-07-13)**: fórmulas de `momentum_score`/
  `velocity_score`/`risk_score` definidas em
  [../aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md),
  "Scores de Narrativa" — esta página reusa `get_narratives_table()`
  filtrado a Narrativas de topo, não inventa um cálculo novo.
- **Narrativas dentro de cada pauta**: ver decisão de modelagem acima.
- **Plataforma por pauta**: idêntico a `bw_query_metrics_daily_by_platform`
  filtrado por `category_id` da pauta (mesma Narrativa de topo) — sem gap.
- **Autores e comunidades por pauta**: idêntico a `bw_query_top_authors`
  filtrado por `category_id` da pauta — sem gap, mas sem a classificação de
  papel do autor (imprensa/especialista/influenciador/movimento/cidadão/
  perfil político) pedida no texto original: essa classificação **não é
  dado da Brandwatch** e está listada em `_index.md` como explicitamente
  fora de escopo do MVP ("Clusterização semântica por IA e classificação de
  papel do autor"). Mostrar só o que já existe (`account_type` nativo da
  Brandwatch, quando presente), sem inventar a taxonomia própria.
- **Termos emergentes**: de `bw_query_topics` filtrado por `category_id` da
  pauta, ordenado por `trending` desc — sem gap.
- **Comparação entre períodos**: ver "Fluxo principal" item 4.

## Regras de negócio

- Nenhum cálculo local sobre `mentions` — mesma regra de todas as páginas
  deste módulo.
- "Pauta" não é uma tabela nova — é `narratives` filtrado por
  `bw_category_id` apontando a uma Category raiz. Nenhuma migration
  necessária para esta spec além da já existente.

## Dados envolvidos

- **Lê**: `narratives` (+ `bw_category_id`/`bw_categories.parent_id` para
  distinguir pauta de narrativa-filha), `narrative_metrics`,
  `bw_query_metrics_daily_by_platform`, `bw_query_top_authors`,
  `bw_query_topics`.
- Nenhuma escrita nesta versão (a menos que a decisão pendente acima leve a
  curar Subcategories como `narratives` manualmente — já suportado pela UI
  de `narratives`, sem tela nova).

## Permissões

Mesma tabela de `executive-overview.md`.

## Referências relacionadas

- [intelligence-center/overview.md](overview.md)
- [intelligence-center/narratives-exploration.md](narratives-exploration.md)
- [intelligence-center/sentiment-analysis.md](sentiment-analysis.md)
- [foundation/data-model.md](../foundation/data-model.md)
- [_index.md](../_index.md) — "Fora de escopo do MVP" (classificação de papel do autor, clusterização por IA)
