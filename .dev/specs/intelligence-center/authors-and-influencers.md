---
tipo: feature-spec
módulo: intelligence-center
funcionalidade: authors-and-influencers
status: implementado
atualizado: 2026-07-25
---

# Autores e Influenciadores

> ✅ **Implementado parcialmente (2026-07-25)**, pedido do usuário: "mover
> Perfis relevantes, X Themes (Hashtags, Posters, Stories, Emojis), Most
> Mentioned X Posters, Top Stories e Top Emojis para a página Autores e
> Influenciadores." Até esta sessão, `/authors` era um placeholder
> (`ComingSoonPage`, fora do route group `(analytics)` — sem organização/
> período) — `_index.md` já previa a página completa como dependente de
> `entities`/`event-radar` (Sprint 3-4, classificação de espectro político/
> tipo de autor), o que continua **não implementado**. O que esta sessão
> entrega é um subconjunto real e já funcional que não dependia de
> `entities` pra existir: os 2 widgets abaixo já rodavam em `/platforms`
> desde 2026-07-12/18 sobre dado 100% pronto (`bw_query_top_authors`/
> `bw_query_top_tweeters`/`bw_query_x_insights`) — só precisavam de uma
> página própria, que faz mais sentido conceitualmente aqui do que em
> Plataformas.

## Objetivo

Mostrar quem são os autores/perfis mais relevantes em monitoramento e o
conteúdo de maior alcance específico da rede X (Twitter) — hashtags,
perfis mais citados, stories/URLs e emojis mais usados.

## Usuários afetados

Mesmo público das demais páginas deste módulo.

## Fluxo principal

1. Usuário acessa `/authors` (item "Autores e Influenciadores" da barra
   lateral, sob ANÁLISES) — mesmos filtros globais de organização/período
   do header (`(analytics)` route group).
2. Widgets carregados independentemente:
   - Perfis relevantes (ranking de autores).
   - X Themes (Hashtags, Posters, Stories, Emojis).

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Nenhum autor sincronizado ainda | `<EmptyState />` no widget "Perfis relevantes" |
| Nenhum dado de X sincronizado (Query/Narrativa sem presença relevante em X) | `<EmptyState />` no widget "X Themes" |
| Falha ao carregar um widget | `<ErrorMessage retry />` isolado |

## Interface (UI)

- **Perfis relevantes**: `AuthorsList` (`components/intelligence-center/
  authors-list.tsx`) — mesmo componente já usado em `/platforms`/`/themes`/
  no detalhe de Narrativa, ranking de `bw_query_top_authors` (+
  `bw_query_top_tweeters` quando a Query tem presença em X) por
  `reach_estimate`/`impact`/`volume`, com badge de sentimento dominante só
  pros top 10 autores enriquecidos (`bw_query_author_topics`) e chips de
  Narrativa/Pauta associada quando aplicável. Escopo "Query inteira" (sem
  filtro de Narrativa) — mesmo padrão de `/platforms` antes da mudança, não
  o escopo `'pautas'` que `/themes` usa.
- **X Themes (Hashtags, Posters, Stories, Emojis)**: `XInsightsPanel`
  (`components/intelligence-center/x-insights-panel.tsx`) — 4 tabelas lado
  a lado (Top Hashtags/Most Mentioned X Posters/Top Stories/Top Emojis),
  mesmas colunas do dashboard nativo da Brandwatch (Posts/Reposts/All
  Posts/Impressions). Ver `platform-analysis.md` (seção histórica) e
  `aggregated-metrics/sql-aggregation.md` (`get_x_insights`) para a origem
  completa do dado — nada mudou na function/dado, só a página que o exibe.

## Regras de negócio

Nenhuma nova — reusa `get_authors_ranking`/`get_x_insights`
(`aggregated-metrics/sql-aggregation.md`) exatamente como já rodavam em
`/platforms`. `PAGE_BLOCKS.authors` (service layer) ganhou `'x_insights'`
além do `'authors'` que já existia (a constante já antecipava a página,
nunca tinha widget correspondente).

## Dados envolvidos

- **Lê**: `bw_query_top_authors`, `bw_query_top_tweeters`,
  `bw_query_author_topics`, `bw_query_x_insights` — todos já sincronizados
  desde `foundation`, sem mudança de captura.
- Nenhuma escrita.

## Permissões

Mesma tabela de `executive-overview.md` — leitura só para membros da
organização (RLS via `auth_organization_ids()`).

## Dependências técnicas

- Nova Edge Function `get-page-authors` (`supabase/functions/get-page-authors/`)
  — cópia do arquivo canônico (`supabase/functions-shared-source/
  aggregated-metrics-service.ts`) + handler, mesmo padrão das outras 6
  Edge Functions `get-page-*` (Princípio técnico 5).
- Página movida para dentro do route group `(analytics)`
  (`app/(intelligence-center)/(analytics)/authors/`) — antes ficava em
  `app/(intelligence-center)/authors/` (mesmo nível de `/admin/users`/
  `/perfil`), sem gate de organização/período, já que era só um
  `ComingSoonPage` estático.

## Gaps conhecidos (fora de escopo desta sessão)

- Classificação de espectro político/tipo de autor (`entities`/
  `entity_tags`) — depende de Sprint 3, não implementada. A página de hoje
  mostra ranking por alcance/engajamento, não uma visão editorializada por
  afiliação.
- `authors[].risk_level` sempre `null` — gap pré-existente, ver
  `_pending.md` gap #11 (nenhuma spec define fórmula de risco por autor
  individual).

## Referências relacionadas

- [platform-analysis.md](platform-analysis.md) — origem histórica destes 2
  widgets.
- [aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md)
- [aggregated-metrics/edge-functions-per-page.md](../aggregated-metrics/edge-functions-per-page.md)
