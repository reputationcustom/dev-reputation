---
tipo: module-overview
módulo: aggregated-metrics
status: pronto
atualizado: 2026-07-12
---

# Módulo: Métricas Agregadas (camada de síntese para frontend + IA)

> Nasceu junto com `event-radar` a partir de um índice próprio
> (`_index_agente_inteligente.md`, removido — conteúdo mesclado em
> `_index.md`) escrito antes de reler o schema já implementado neste
> projeto. Corrigido nesta revisão (2026-07-12) para se apoiar nas tabelas
> de agregado oficial da Brandwatch que `foundation` já sincroniza, em vez
> de um schema genérico (`mentions`/`entities`/`grafo_arestas`) que não
> existe aqui — ver a nota "Fusão de módulos" em `_index.md` para o resumo
> completo de todas as correções aplicadas.

## Objetivo

Este módulo é a camada intermediária entre os dados brutos/agregados já sincronizados da
Brandwatch por `foundation` (`bw_query_metrics_daily`/`weekly`/`monthly`,
`bw_query_metrics_daily_by_platform`, `narrative_metrics`, `bw_query_topics`,
`bw_query_top_authors`, ver `foundation/data-model.md`) e as páginas do frontend — todas em
`intelligence-center` (Sprint 2, incl. Executive Overview — ver nota de rotas abaixo), mais
Autores/Alertas/Relatórios dos Sprints 3-4. Ele existe para resolver dois problemas ao mesmo tempo:

1. Entregar ao frontend um JSON já agregado e pronto para renderizar (sem cálculo no cliente —
   Princípio técnico 2 em `_index.md`).
2. Entregar esse **mesmo JSON**, sem alterações estruturais, para a IA de síntese narrativa
   transformar em texto explicativo (o "insight automático" que aparece nas páginas).

O sistema NÃO deve ter dois formatos de dado diferentes — um para o gráfico e outro para o
prompt da IA. É um único contrato (`envelope`), reaproveitado nos dois consumos.

## Funcionalidades

| Funcionalidade              | Descrição resumida                                              | Status   | Spec                                                              |
|------------------------------|--------------------------------------------------------------------|----------|--------------------------------------------------------------------|
| `standard-json-envelope`     | Contrato único de resposta usado por todas as páginas            | pronto   | [standard-json-envelope.md](standard-json-envelope.md)                |
| `sql-aggregation`            | Views/functions Postgres que calculam cada bloco atomicamente    | pronto   | [sql-aggregation.md](sql-aggregation.md)                               |
| `service-layer-aggregation`  | Camada TS que monta o envelope a partir dos blocos SQL           | pronto   | [service-layer-aggregation.md](service-layer-aggregation.md)           |
| `edge-functions-per-page`    | Uma Edge Function fina por página, só orquestra os blocos        | pronto   | [edge-functions-per-page.md](edge-functions-per-page.md)       |
| `ai-synthesis`               | Envio do envelope para a IA gerar o texto explicativo da página  | pronto   | [ai-synthesis.md](ai-synthesis.md)                                     |

## Dependências

- **Módulos que este depende**: `foundation` (`sync-brandwatch` popula os agregados oficiais;
  `narratives` popula `narratives`/`narrative_metrics`), `event-radar` (popula `feed_events`
  — fonte de `highlights` e base de `narrative_text`; ver
  [standard-json-envelope.md](standard-json-envelope.md), seção "Integração com event-radar").
  `entities` (Sprint 2, ainda não spec'd) enriquece o bloco `authors` quando existir, mas não é
  um bloqueador — o ranking em si já vem de `bw_query_top_authors`/`bw_query_top_tweeters`
  (nativos da Brandwatch, ver `sql-aggregation.md`).
- **Módulos que dependem deste**: `intelligence-center` (todas as suas páginas, incl.
  `executive-overview.md`, passam a ler o envelope em vez de montar a consulta inline — ver nota
  de rotas abaixo), e os módulos ainda sem spec própria `entities` (página Autores), `event-radar`
  (página Alertas — leitura, não escrita) e `executive-reports` (página Relatórios, Sprint 4,
  reaproveita o mesmo envelope agregado por período maior).

## Rotas/Páginas

> ✅ **Rotas alinhadas (2026-07-12)** às já `pronto` em
> `intelligence-center/executive-overview.md`/`intelligence-center/overview.md` — a
> primeira versão desta spec usava rotas em português (`/visao-geral`,
> `/narrativas`, `/pautas-eleitorais`...), divergentes das já aprovadas.
> Autores/Alertas/Relatórios são rotas novas (sem spec de página própria
> ainda — pertencem a `entities`/`event-radar`/`executive-reports`), nomeadas
> em inglês pelo mesmo padrão. **Correção (2026-07-12)**: `/overview` tinha
> `foundation` como "módulo dono da página" — inconsistente, já que
> `foundation` é só backend (ver `foundation/overview.md`). Corrigido para
> `intelligence-center`, mesmo dono de todas as outras páginas do frontend.

| Rota                 | Edge Function            | Página                              | Módulo dono da página |
|-----------------------|---------------------------|--------------------------------------|--------------------------|
| `/overview`           | `get-page-overview`       | Visão Geral (Executive Overview)     | `intelligence-center` |
| `/narratives`         | `get-page-narratives`     | Narrativas (lista)                   | `intelligence-center` |
| `/narratives/[id]`    | `get-narrative-detail`    | Narrativas (detalhe)                 | `intelligence-center` |
| `/sentiment`          | `get-page-sentiment`      | Análise de Sentimento                | `intelligence-center` |
| `/platforms`          | `get-page-platforms`      | Análise por Plataforma               | `intelligence-center` |
| `/themes`             | `get-page-themes`         | Pautas Eleitorais                    | `intelligence-center` |
| `/authors`            | `get-page-authors`        | Autores e Influenciadores            | `entities` (sem spec própria ainda) |
| `/alerts`             | `get-page-alerts`         | Alertas                              | `event-radar` |
| `/reports`            | `get-page-reports`        | Relatórios                           | `executive-reports` (sem spec própria ainda) |

9 Edge Functions de página no total (8 páginas de menu — Narrativas conta como uma só, com
lista+detalhe).

## Dados gerenciados

Este módulo não possui tabelas próprias — ele lê das tabelas já modeladas em
`foundation/data-model.md` (agregados oficiais da Brandwatch, `narratives`/`narrative_metrics`)
e de `feed_events` (populada por `event-radar`). Ver [sql-aggregation.md](sql-aggregation.md) para
o mapeamento de cada bloco do envelope às tabelas de origem reais.

## Notas para implementação

- O Claude Code deve implementar `standard-json-envelope.md` **primeiro** — é o contrato do qual
  todo o resto depende.
- Nenhuma Edge Function deve conter lógica de agregação própria. Toda agregação vive em SQL
  (views/RPC) ou na `service-layer-aggregation`. A Edge Function apenas escolhe quais blocos pedir
  e monta o envelope final.
- Nenhuma function SQL deste módulo agrega sobre `mentions` para representar um total — reusa os
  agregados oficiais já sincronizados por `foundation` (mesma premissa de `_index.md`/`CLAUDE.md`,
  "nunca calcular localmente sobre mentions amostrada"). Ver `sql-aggregation.md`.
- Sempre respeitar `filters_applied` e `period` vindos do header global (organização e período
  ativos) — ver módulo de navegação/header, que preserva esses filtros entre páginas.
- Cache: o envelope de cada página deve ser cacheado (ver `edge-functions-per-page.md`) e
  invalidado quando o sync da Brandwatch rodar ou quando o usuário trocar filtros/período.
