---
tipo: feature-spec
módulo: aggregated-metrics
funcionalidade: service-layer-aggregation
status: pronto
atualizado: 2026-07-20
---

# Service Layer de Agregação (TypeScript)

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
   `fetchTermSignals`, `fetchGraph`), em paralelo (`Promise.all`), nunca em série.
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
- `PAGE_BLOCKS` deve ser uma constante única, tipada, espelhando exatamente a tabela de
  [block-mapping-per-page.md](block-mapping-per-page.md). Se a tabela mudar, esta
  constante deve ser atualizada junto — o Claude Code deve tratar os dois como uma coisa só.
- Erros de uma function SQL individual não devem derrubar o envelope inteiro: se
  `fetchTermSignals` falhar, por exemplo, o bloco correspondente deve retornar `[]` e o restante
  do envelope segue normalmente. Logar o erro, não propagar.

## Interface (código)

- **Entrada**: `assemblePageResponse(page: PageKey, context: { organizationId, period, filters })`
- **Saída**: objeto no formato do envelope (`standard-json-envelope.md`), incluindo `generated_at`
  preenchido no momento da montagem.
- **Estado de erro parcial**: bloco individual retorna vazio + log, envelope inteiro nunca falha
  por causa de um bloco só (ver regra acima).

## Dependências técnicas

- Cliente Supabase configurado para chamar as functions RPC de `sql-aggregation.md`.
- Tipos TypeScript do envelope compartilhados entre frontend e Edge Functions (ver nota abaixo).

> ⚠️ DECISÃO PENDENTE: definir se os tipos TS do envelope ficam em um pacote compartilhado
> (`packages/shared-types`) ou duplicados entre frontend e `supabase/functions`. Recomendação:
> pacote compartilhado, para não haver drift entre o tipo usado no client e no server.

## Referências relacionadas

- [overview.md](overview.md)
- [standard-json-envelope.md](standard-json-envelope.md)
- [sql-aggregation.md](sql-aggregation.md)
- [block-mapping-per-page.md](block-mapping-per-page.md)
- [edge-functions-per-page.md](edge-functions-per-page.md)
