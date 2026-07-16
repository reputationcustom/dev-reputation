---
tipo: module-overview
módulo: aggregated-metrics
status: implementado
atualizado: 2026-08-03
---

> ✅ **Corrigido nesta revisão (2026-07-25)**: este arquivo e as 6 specs
> filhas ficaram com `status: pronto` (spec pronta, não implementada) por
> meses depois do módulo já estar genuinamente implementado (ver
> `_architecture.md`, corrigido em 2026-07-16, e `CLAUDE.md`) —
> `_index.md`'s tabela de módulos também estava com a mesma defasagem,
> ambas corrigidas agora. Na mesma sessão, 4 gaps técnicos + 1 decisão
> pendente foram fechados: termo de interação em `risk_score` (decisão
> #3), breakdown de região, trend de plataforma/pauta ao longo do tempo,
> cache de página (TTL) e a Camada 0 de `ai-synthesis` — ver `_pending.md`
> pros detalhes de cada um.
>
> ✅ **Atualizado (2026-08-03)** — o parágrafo acima ("Únicos gaps reais
> que continuam pendentes: `get_active_highlights`... e
> `page_narrative_synthesis`...") ficou desatualizado e foi removido: os
> dois foram implementados em 2026-08-02 (`event-radar/
> fluxo-aggregated-metrics.md`, "Fase B") — `get_active_highlights` é a
> function real por trás do bloco `highlights`, e `page_narrative_synthesis`
> é a tabela da Camada 1 de `ai-synthesis`. As 10/10 functions SQL do
> módulo estão completas; `ai-synthesis` tem Camadas 0 e 1 implementadas
> (Camada 2 continua não implementada por desenho — exceção que precisa de
> justificativa por página, não um gap, ver `ai-synthesis.md`). Achado de
> passagem, corrigido na mesma revisão: a linha de `edge-functions-per-page`
> na tabela abaixo ainda dizia "cache de página com TTL" — `page_cache`
> está **desabilitado** desde a investigação de `/narratives` retornando
> vazio (ver `CLAUDE.md`, "`page_cache` desabilitado"), não só "sem
> invalidação manual".

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
| `standard-json-envelope`     | Contrato único de resposta usado por todas as páginas            | implementado | [standard-json-envelope.md](standard-json-envelope.md)                |
| `sql-aggregation`            | Views/functions Postgres que calculam cada bloco atomicamente    | implementado — 10/10 functions, incl. `get_active_highlights` (2026-08-02) | [sql-aggregation.md](sql-aggregation.md)                               |
| `service-layer-aggregation`  | Camada TS que monta o envelope a partir dos blocos SQL           | implementado | [service-layer-aggregation.md](service-layer-aggregation.md)           |
| `edge-functions-per-page`    | Uma Edge Function fina por página, só orquestra os blocos        | implementado — `page_cache` (TTL) desabilitado desde a investigação de `/narratives` vazio, ver `CLAUDE.md` | [edge-functions-per-page.md](edge-functions-per-page.md)       |
| `ai-synthesis`               | Envio do envelope para a IA gerar o texto explicativo da página  | implementado — Camadas 0 e 1 (Camada 2 não implementada por desenho, exceção por página) | [ai-synthesis.md](ai-synthesis.md)                                     |

## Dependências

- **Módulos que este depende**: `foundation` (`sync-brandwatch` popula os agregados oficiais;
  `narratives` popula `narratives`/`narrative_metrics`), `event-radar` (popula `feed_events`
  — fonte de `highlights` e base de `narrative_text`; ver
  [standard-json-envelope.md](standard-json-envelope.md), seção "Integração com event-radar").
  ✅ **`entities` especificado (2026-07-13)** — [../entities/overview.md](../entities/overview.md)
  enriquece o bloco `authors` de forma aditiva (`get_authors_ranking`, ver
  [../entities/author-linking.md](../entities/author-linking.md)) quando implementado, mas não é
  um bloqueador — o ranking em si já vem de `bw_query_top_authors`/`bw_query_top_tweeters`
  (nativos da Brandwatch, ver `sql-aggregation.md`).
- **Módulos que dependem deste**: `intelligence-center` (todas as suas páginas, incl.
  `executive-overview.md`/`authors-and-influencers.md`, passam a ler o envelope em vez de montar a
  consulta inline — ver nota de rotas abaixo), `event-radar` (página Alertas — leitura, não
  escrita, ainda sem spec própria) e `executive-reports` (página Relatórios, Sprint 4, ainda sem
  spec própria, reaproveita o mesmo envelope agregado por período maior).

## Rotas/Páginas

> ✅ **Rotas alinhadas (2026-07-12)** às já `pronto` em
> `intelligence-center/executive-overview.md`/`intelligence-center/overview.md` — a
> primeira versão desta spec usava rotas em português (`/visao-geral`,
> `/narrativas`, `/pautas-eleitorais`...), divergentes das já aprovadas.
> **Correção (2026-07-12)**: `/overview` tinha
> `foundation` como "módulo dono da página" — inconsistente, já que
> `foundation` é só backend (ver `foundation/overview.md`). Corrigido para
> `intelligence-center`, mesmo dono de todas as outras páginas do frontend
> (mesmo critério aplicado a `/authors` abaixo — a página em si é sempre
> `intelligence-center`, mesmo quando o **dado** que ela mostra vem
> enriquecido por outro módulo). ✅ **`/authors` implementada (2026-07-25)**
> — ver `intelligence-center/authors-and-influencers.md`; `/alerts`/
> `/reports` continuam sem spec de página própria (dependem de
> `event-radar`/`executive-reports`, Sprint 3-4).

| Rota                 | Edge Function            | Página                              | Módulo dono da página |
|-----------------------|---------------------------|--------------------------------------|--------------------------|
| `/overview`           | `get-page-overview`       | Visão Geral (Executive Overview)     | `intelligence-center` |
| `/narratives`         | `get-page-narratives`     | Narrativas (lista)                   | `intelligence-center` |
| `/narratives/[id]`    | `get-narrative-detail`    | Narrativas (detalhe)                 | `intelligence-center` |
| `/sentiment`          | `get-page-sentiment`      | Análise de Sentimento                | `intelligence-center` |
| `/platforms`          | `get-page-platforms`      | Análise por Plataforma               | `intelligence-center` |
| `/themes`             | `get-page-themes`         | Pautas Eleitorais                    | `intelligence-center` |
| `/authors`            | `get-page-authors`        | Autores e Influenciadores            | `intelligence-center` (implementada — ver `authors-and-influencers.md`; classificação por `entities` ainda não ligada, gap conhecido) |
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
