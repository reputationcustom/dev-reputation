---
tipo: module-overview
módulo: intelligence-center
status: pronto
atualizado: 2026-07-12
---

# Módulo: Intelligence Center (Sprint 2)

> Origem: protótipo de frontend "Comunicação Inteligente" (claude.ai/design,
> projeto `9a62a59b-c1f7-48b5-a05b-5d72e6f0db9a`) + documento de estrutura
> recomendada (`scratch/document.txt` do mesmo projeto). O protótipo
> interativo em si só implementa duas telas de verdade (Visão Geral —
> já coberta por `foundation/executive-overview.md` — e Narrativas
> list+detail); as demais páginas do documento de estrutura (Sentimento,
> Plataformas, Pautas Eleitorais) existem só como itens de menu
> desabilitados no protótipo (`navStatic`), sem tela construída. Este
> módulo nasce como a especificação escrita dessas páginas, seguindo o
> processo de spec-driven development do projeto — pedido explícito do
> usuário em 2026-07-12: "prosseguir com a especificação de todas as
> páginas do ponto de vista de frontend e também de captura dos dados na
> base integrada da brandwatch que já desenvolvemos no supabase".

## Objetivo

Dar à equipe de comunicação um espaço de exploração livre (com filtros) sobre
as Narrativas e mentions já sincronizadas — complementar ao Executive
Overview, que é a visão executiva "de relance". Aqui o usuário aprofunda:
qual narrativa investigar, por que o sentimento mudou, onde (plataforma) a
conversa está acontecendo, e qual pauta política está ganhando ou perdendo
espaço.

## Funcionalidades

| Feature | Spec | Status | Depende de |
|---|---|---|---|
| Exploração de Narrativas (lista + detalhe) | [narratives-exploration.md](narratives-exploration.md) | pronto | `foundation` (narratives, narrative_metrics, bw_query_top_authors); "Ações e decisões" depende de `command-center` (ainda rascunho, ver seu `overview.md`) |
| Análise de Sentimento | [sentiment-analysis.md](sentiment-analysis.md) | pronto | `foundation` (bw_query_metrics_daily, bw_query_topics, bw_query_demographics_daily) |
| Análise por Plataforma | [platform-analysis.md](platform-analysis.md) | pronto | `foundation` (bw_query_metrics_daily_by_platform) |
| Pautas Eleitorais | [electoral-themes.md](electoral-themes.md) | pronto | `foundation` (bw_categories hierarquia, narratives) |

Todas as quatro são **só leitura** — nenhuma escreve dado novo, todas
consomem exclusivamente o que `bw-sync`/`refresh_narrative_metrics()` já
sincronizam (ver `foundation/data-model.md`). Nenhuma tem lógica de negócio
no frontend (Princípio técnico 2).

## Gaps de dados — resolvidos em 2026-07-12

Ao mapear o protótipo contra `foundation/data-model.md`, várias métricas
pedidas pelo desenho pareciam **não ter agregado oficial da Brandwatch**
disponível. O usuário pediu para rever a captura antes de aceitar omitir
qualquer uma — pesquisa mais a fundo contra
`developers.brandwatch.com/docs/chart-dimensions-and-aggregates` encontrou
fonte oficial para praticamente todas (migration `20260712020000`,
`bw-sync/index.ts`):

- **Autores únicos** (card do Executive Overview, detalhe de Narrativa) —
  ✅ resolvido via aggregate de chart `authors` ("distinct authors who
  posted"), oficial e não amostrado. `bw_query_metrics_daily.unique_authors`/
  `narrative_metrics.unique_authors`.
- **Autores únicos por plataforma** / **Engajamento médio por plataforma**
  (Plataformas) — ✅ resolvidos, mesmo aggregate `authors` +
  `engagementScore` já usados acima, dimensão `pageTypes` em vez de
  `categories`. `bw_query_metrics_daily_by_platform.unique_authors`/
  `.engagement_score`.
- **Sentimento por plataforma** (Sentimento) / **Sentimento por
  localização** (Sentimento) — ✅ resolvidos via aggregate `netSentiment`,
  dimensões `pageTypes`/`countries`/`continents`/`cities`/`regions`. ⚠️
  **Limitação que continua real, não um gap de captura**: `netSentiment`
  devolve um score único, não o split positivo/neutro/negativo do resto do
  produto (a API não combina 3 dimensões — `sentiment`+`pageTypes`+`days` —
  numa chamada só). Exibir como indicador visualmente distinto na UI.
- **Grafo de propagação completo** (Narrativas → detalhe) — segue sendo
  escopo do módulo `propagation-graph` (Sprint 3). ✅ Decisão tomada
  (2026-07-12): construir uma versão simplificada já nesta Sprint 2, sobre
  os campos de relacionamento já capturados por mention (`reply_to`/
  `retweet_of`/`insights_mentioned`), rotulada como amostra das mentions já
  sincronizadas — ver `narratives-exploration.md`.
- **"Ações e decisões"** (detalhe de Narrativa) — depende do módulo
  `command-center`, que ainda não tem schema (`cases`) implementado. Ver
  [command-center/overview.md](../command-center/overview.md) para o
  detalhamento do que falta.
- **Autores únicos** e **Sentimento** (2 métricas acima) mudam de "sem
  fonte oficial" para "capturado, com uma limitação documentada" ou
  "resolvido sem ressalva" — nenhuma aproximação amostrada foi aceita em
  lugar nenhum; a premissa de 2026-07-11 ("nunca calcular localmente sobre
  `mentions` amostrada") continua de pé, só a busca por fonte oficial foi
  mais a fundo.

## Rotas/Páginas (sugestão, não fechada)

| Rota | Página |
|---|---|
| `/narratives` | Exploração de Narrativas (lista) |
| `/narratives/[id]` | Detalhe de Narrativa |
| `/sentiment` | Análise de Sentimento |
| `/platforms` | Análise por Plataforma |
| `/themes` | Pautas Eleitorais |

⚠️ DECISÃO PENDENTE: mesma ressalva já registrada em
`foundation/executive-overview.md` para `/narratives/[id]` — rota exata
(página própria vs. modal) fica para quando o roteamento geral do app for
fechado.

## Referências relacionadas

- [foundation/executive-overview.md](../foundation/executive-overview.md)
- [foundation/data-model.md](../foundation/data-model.md)
- [foundation/narratives.md](../foundation/narratives.md)
- [_index.md](../_index.md) — módulos `intelligence-center`/`propagation-graph`
