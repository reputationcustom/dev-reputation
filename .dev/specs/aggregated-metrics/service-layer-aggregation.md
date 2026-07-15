---
tipo: feature-spec
módulo: aggregated-metrics
funcionalidade: service-layer-aggregation
status: implementado
atualizado: 2026-07-22
---

# Service Layer de Agregação (TypeScript)

> ✅ **Implementado (2026-07-14, migration de código
> `supabase/functions-shared-source/aggregated-metrics-service.ts`)** —
> `assemblePageResponse`/`PAGE_BLOCKS`/os 9 `fetchX` (incl. `fetchXInsights`,
> adicionado 2026-07-18) estão em produção, copiados por Princípio técnico
> 5 para dentro de cada uma das 6 Edge Functions `get-page-*`/
> `get-narrative-detail`. A decisão pendente original deste arquivo (pacote
> de tipos compartilhado) foi resolvida no mesmo dia — ver nota abaixo.

## Objetivo

Camada TypeScript compartilhada entre todas as Edge Functions, responsável por chamar as
functions SQL de [sql-aggregation.md](sql-aggregation.md) e montar o envelope final descrito em
[standard-json-envelope.md](standard-json-envelope.md). É esta camada — e não a Edge Function — que
concentra o reaproveitamento de código entre páginas.

## Fluxo principal

1. A Edge Function da página chama `assemblePageResponse(page, blockKeys, context)`.
2. `assemblePageResponse` lê em `block-mapping-per-page.md` (via uma constante
   `PAGE_BLOCKS` no código, não lendo o markdown em runtime) quais blocos aquela página precisa.
3. Para cada bloco necessário, chama a função de fetch correspondente (`fetchMetrics`,
   `fetchBreakdown`, `fetchTrend`, `fetchNarratives`, `fetchAuthors`, `fetchHighlights`,
   `fetchTermSignals`, `fetchGraph`), em paralelo (`Promise.all`), nunca em série. ✅ **Exceção
   pontual pra `themes` (2026-08-09)** — `fetchNarratives` roda um passo antes do `Promise.all`
   só nessa página, pra poder escopar `filters.narratives` (usado por `fetchHighlights`/
   `fetchNarrativeText`) aos IDs das Narrativas-Pauta antes de buscá-los — sem isso, "Insights" em
   `/themes` lia a organização inteira em vez de só Pautas (bug real, ver `electoral-themes.md`/
   `ai-synthesis.md`). Toda outra página continua 100% paralela.
4. Monta o objeto envelope completo, preenchendo com `[]`/`null` os blocos não usados pela
   página.
5. Retorna o envelope pronto para a Edge Function apenas repassar como resposta.

## Regras de negócio

- Cada `fetchX` desta camada corresponde 1:1 a uma function SQL — esta camada não deve conter
  lógica de agregação própria, apenas chamada + normalização de tipos (datas, números).
- ✅ **`fetchNarratives` recebe `page` (2026-07-16)**: `narrativesScopeForPage(page)` resolve
  `p_scope` (ver `sql-aggregation.md`) — é a única `fetchX` que precisa saber qual página a
  chamou; as demais continuam recebendo só `(supabase, ctx)`. ✅ **Revisto duas vezes desde
  então**: 2026-07-20 tinha feito Overview/Narrativas pedirem `null` (sem restrição — Category
  raiz + Subcategory juntas, viabilizado por um título composto "Categoria - Subcategoria").
  ✅ **2026-07-21** (pedido do usuário: "Para facilitar vamos considerar apenas as subcategorias
  em todas as narrativas. Retire a regra de 'categoria - subcategoria'. Em Pautas faz-se uma
  restrição de todas as subcategorias da categoria Pautas") reverteu isso: `narrativesScopeForPage`
  agora retorna `'leaves' | 'pautas'` (sem `'roots'`/`null'` — nenhuma página mais precisa deles).
  Toda página usa `'leaves'` (Overview, Narrativas, Plataformas, Relatórios); `themes` (Pautas
  Eleitorais) usa `'pautas'` — um terceiro valor, mais restrito, só Subcategories cuja
  Category-pai é a Category raiz chamada "Pautas" (`pautas_root_category_id()`, migration
  `20260721030000`), não qualquer Category raiz do Project.
- ✅ **`fetchAuthors` recebe `page` (2026-07-21)**, mesmo padrão de `fetchNarratives`: quando
  `page === 'themes'`, passa `p_scope: 'pautas'` pro RPC `get_authors_ranking` — escopa o ranking
  às Subcategories de "Pautas" em vez da Query inteira/1 Narrativa, e o resultado passa a incluir
  `narrative_labels` (a quais pautas cada autor está associado, pode ser mais de uma). Pedido do
  usuário: "em Autores e comunidades por pauta deve aparecer apenas os autores que citaram algo
  relacionado às Pautas e deve ser informado a que pauta ele está associado."
- ✅ **`PageContext.topicSort` (2026-08-09, migration `20260809130000`)** — `'trending' | 'volume'`,
  opcional. `fetchNarratives`/`fetchTermSignals` repassam `ctx.topicSort ?? 'trending'` como
  `p_topic_sort` pras RPCs correspondentes (`get_narratives_table`/`get_term_signals`, ver
  `sql-aggregation.md`, "Perspectiva de ranking Trending × Volume"). Handler HTTP: só as 6
  Edge Functions cujo `PAGE_BLOCKS` inclui `'narratives'` ou `'term_signals'`
  (`get-page-{overview,narratives,sentiment,platforms,themes}`, `get-narrative-detail`) leem
  `body.topic_sort` (via `normalizeTopicSort`, handler-específico — mesmo padrão de `pauta_id`,
  não faz parte do corpo canônico compartilhado); `get-page-authors`/`compose-narrative-synthesis`
  não usam nenhum dos dois blocos, então não aceitam esse campo. ⚠️ **Exceção**: o payload de IA
  (Camada 2, `platforms:featured_content`) sempre usa `'trending'`, independente de
  `context.topicSort` — ver `ai-synthesis.md`.
- `PAGE_BLOCKS` deve ser uma constante única, tipada, espelhando exatamente a tabela de
  [block-mapping-per-page.md](block-mapping-per-page.md). Se a tabela mudar, esta
  constante deve ser atualizada junto — o Claude Code deve tratar os dois como uma coisa só.
- Erros de uma function SQL individual não devem derrubar o envelope inteiro: se
  `fetchTermSignals` falhar, por exemplo, o bloco correspondente deve retornar `[]` e o restante
  do envelope segue normalmente. Logar o erro, não propagar.
- ✅ **`fetchNarrativeText` implementada (2026-07-25)** — Camada 0 de `ai-synthesis.md`,
  ver `ai-synthesis.md` para o fluxo completo. `narrative_text` deixa de ser sempre `null`.
- ✅ **`getPageEnvelopeWithCache` implementada (2026-07-25, gap #21)** — wrapper em torno de
  `assemblePageResponse`, checa/grava `page_cache` (TTL 5min) antes/depois de montar o envelope.
  As 6 Edge Functions chamam esta function no lugar de `assemblePageResponse` diretamente. Ver
  `edge-functions-per-page.md`.

## Interface (código)

- **Entrada**: `assemblePageResponse(page: PageKey, context: { organizationId, period, filters })`
- **Saída**: objeto no formato do envelope (`standard-json-envelope.md`), incluindo `generated_at`
  preenchido no momento da montagem.
- **Estado de erro parcial**: bloco individual retorna vazio + log, envelope inteiro nunca falha
  por causa de um bloco só (ver regra acima).

## Dependências técnicas

- Cliente Supabase configurado para chamar as functions RPC de `sql-aggregation.md`.
- Tipos TypeScript do envelope compartilhados entre frontend e Edge Functions (ver nota abaixo).

> ✅ **Resolvida (2026-07-14)**: tipos TS do envelope ficam em pacote compartilhado —
> `packages/shared-types` (`@reputation/shared-types`, primeiro workspace npm deste repo),
> consumido pelo frontend via `next.config.ts`'s `transpilePackages`. Ressalva: isso resolve só
> o lado Next.js/frontend — Edge Functions continuam sem conseguir importar um pacote de
> workspace local em produção (Princípio técnico 5), então
> `supabase/functions-shared-source/aggregated-metrics-service.ts` mantém sua própria cópia
> inline dos tipos, sincronizada à mão a cada mudança de schema. Ver `_pending.md` (decisão #2,
> resolvida) e `CLAUDE.md`, "aggregated-metrics module (Sprint 2)".

## Referências relacionadas

- [overview.md](overview.md)
- [standard-json-envelope.md](standard-json-envelope.md)
- [sql-aggregation.md](sql-aggregation.md)
- [block-mapping-per-page.md](block-mapping-per-page.md)
- [edge-functions-per-page.md](edge-functions-per-page.md)
