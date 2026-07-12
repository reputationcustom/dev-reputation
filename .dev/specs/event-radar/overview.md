---
tipo: module-overview
módulo: event-radar
status: rascunho
atualizado: 2026-07-12
---

# Módulo: Radar de Eventos

> ✅ **Absorve `threshold-engine`/`intelligent-feed`** (Sprint 3 em `_index.md`, nunca tiveram
> spec própria) — é a especificação concreta do mesmo motor de risco + feed de eventos que esses
> dois módulos previam, com mais rigor (janelas de comparação, dedup, severidade ponderada, card
> de IA). Ver a nota "Fusão de módulos" em `_index.md` e
> [/_fluxo-event-radar-aggregated-metrics.md](../_fluxo-event-radar-aggregated-metrics.md).

## Objetivo

Detectar, de forma determinística (SQL), mudanças de comportamento nas menções — picos,
quedas, mudança de sentimento, narrativas emergentes — e usar uma única chamada de IA por
evento para transformar essa detecção estatística em um card legível para a equipe de
comunicação. É o motor que alimenta `feed_events` (tabela já reservada para "Feed Inteligente"
em `_glossary.md`), de onde o módulo `aggregated-metrics` lê os blocos `highlights` e monta
`narrative_text` de cada página.

**Princípio geral do módulo**: cada linha de código e cada chamada de IA tem custo. A solução
determinística (SQL) é sempre a primeira opção. IA só entra quando a decisão exige linguagem
natural ou julgamento qualitativo — nunca para cálculo, comparação de números ou deduplicação
exata.

## Funcionalidades

| Funcionalidade                    | Descrição resumida                                              | Status    | Spec                                                                |
|-------------------------------------|--------------------------------------------------------------------|-----------|------------------------------------------------------------------------|
| `detection-engine`                  | Views/functions SQL que calculam janelas de comparação e regras   | rascunho  | [detection-engine.md](detection-engine.md)                                 |
| `deduplication-grouping`            | Dedup determinístico antes de qualquer chamada de IA               | rascunho  | [deduplication-grouping.md](deduplication-grouping.md)             |
| `severity`                          | Score 0-100 determinístico + mapeamento para categoria de risco    | rascunho  | [severity.md](severity.md)                                         |
| `agent-orchestrator`                | Única chamada de IA por evento, saída estruturada                  | rascunho  | [agent-orchestrator.md](agent-orchestrator.md)                         |
| `schema-integration`                | Escrita em `feed_events`, `cases`, feedback do analista | rascunho  | [schema-integration.md](schema-integration.md)                           |
| `volume-limits`                     | Cap diário de eventos publicados por organização                   | rascunho  | [volume-limits.md](volume-limits.md)                                 |
| `aggregated-metrics-integration`    | Contrato de campos compartilhado com o envelope de página          | rascunho  | [aggregated-metrics-integration.md](aggregated-metrics-integration.md)   |

## Dependências

- **Módulos que este depende**: `foundation` — `sync-brandwatch` popula os agregados oficiais
  usados nas regras de detecção (`bw_query_metrics_daily`/`weekly`/`monthly`,
  `bw_query_metrics_daily_by_platform`), `narratives`/`narrative_metrics` dá a categorização de
  narrativa/pauta (ver `detection-engine.md`). Fluxo de aprovação de eventos `high`/`critical`
  (ver `integracao-schema.md`) depende de um mecanismo de aprovação ainda sem spec própria — não
  bloqueante, ver nota em `integracao-schema.md`. `entities`/`entity_tags` (Sprint 2) só
  como enriquecimento opcional do payload da IA, nunca pré-requisito.
- **Módulos que dependem deste**: `aggregated-metrics` — especificamente os blocos `highlights`
  e `narrative_text` do envelope, e o campo `momentum_score` de `narratives`. Sem este módulo
  publicando em `feed_events`, esses três pontos ficam permanentemente vazios/no fallback.
  Ver [aggregated-metrics-integration.md](aggregated-metrics-integration.md).

## Ordem de implementação (dentro do módulo)

Este módulo tem uma ordem interna estrita — cada etapa consome a saída da anterior:

1. `detection-engine` (1.1) → grava em `radar_staging_events`
2. `deduplication-grouping` (1.2) → roda sobre `radar_staging_events`, antes de qualquer IA
3. `severity` (1.3) → calcula score sobre os eventos já deduplicados
4. `agent-orchestrator` (1.4) → única chamada de IA, consome eventos com severidade calculada
5. `schema-integration` (1.5) → grava saída do agent em `feed_events` e (quando `high`/`critical`) `cases`
6. `volume-limits` (1.6) → cap aplicado antes da fila de IA (entra como filtro entre 1.3 e 1.4)

> Ver [/_fluxo-event-radar-aggregated-metrics.md](../_fluxo-event-radar-aggregated-metrics.md) para o diagrama completo do
> pipeline, incluindo onde este módulo se conecta a `aggregated-metrics`.

## Rotas/Páginas

Este módulo não expõe páginas próprias — ele alimenta `cases` (linhas pendentes de severidade
alta/crítica, ver `schema-integration.md`) e `feed_events`, ambos já existentes no schema. As
páginas de frontend que exibem sua saída são as de `aggregated-metrics` (bloco `highlights`).

## Dados gerenciados

Ver [schema-integration.md](schema-integration.md) para o detalhamento de `radar_staging_events`,
gravação em `feed_events` e a tabela de feedback do analista.

## Notas para implementação

- Seguir a divisão em duas fases já definida: **Fase 1 — Especificação** (gerar/revisar os
  specs deste módulo com o skill `spec-driven-dev`) e **Fase 2 — Implementação** (só começar
  depois que os specs da Fase 1 estiverem com status `pronto`).
- Testar as etapas 1.1–1.3 isoladamente (sem IA) antes de plugar o orquestrador (1.4) — assim
  bugs de detecção não geram custo de tokens enquanto são corrigidos.
- As 8 restrições de custo abaixo se aplicam a todas as funcionalidades deste módulo e devem ser
  citadas em qualquer PR que toque a etapa 1.4:
  1. IA nunca roda sobre menções individuais — só sobre eventos já agregados pelo SQL.
  2. Nenhum evento chega à IA duas vezes por causa de dedup malfeito.
  3. Payload da IA carrega métricas e agregações, nunca texto bruto de menções.
  4. Resumo executivo é em lote (1x/dia), nunca por evento.
  5. Cap diário de eventos por organização é aplicado antes da fila de IA, não depois.
  6. Um único agent por evento — não uma cadeia de 4 chamadas.
  7. Qualquer chamada de IA adicional precisa de justificativa explícita no spec.
  8. `aggregated-metrics` não introduz uma chamada de IA por carregamento de página — reaproveita
     o texto já publicado por este módulo (ver `aggregated-metrics-integration.md`).
