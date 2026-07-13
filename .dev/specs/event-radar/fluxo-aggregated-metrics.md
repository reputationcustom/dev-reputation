---
tipo: cross-module-flow
módulos: [event-radar, aggregated-metrics]
atualizado: 2026-07-25
---

# Fluxo e Sincronismo — Radar de Eventos ↔ Métricas Agregadas

> ✅ **Movido de `.dev/specs/_fluxo-event-radar-aggregated-metrics.md` para dentro do diretório do
> próprio módulo (2026-07-25)**, a pedido do usuário — este documento é específico da integração
> `event-radar`↔`aggregated-metrics`, então vive melhor junto com o resto de `event-radar/*.md` do
> que solto na raiz de `.dev/specs/` ao lado dos arquivos verdadeiramente transversais
> (`_index.md`, `_architecture.md`, `_glossary.md`, `_pending.md`). Mesma sessão também redesenhou
> o diagrama de dependências (seção 1 abaixo) para deixar explícita a ordem de implementação
> interna do radar (1.1→1.6, já descrita em prosa em `overview.md`) e qual tabela cada etapa lê/
> escreve, agora que existe um `data-model.md` consolidado para consultar. Toda referência a este
> arquivo em `_index.md`/`_architecture.md`/`overview.md`/`aggregated-metrics-integration.md` foi
> atualizada para o novo caminho na mesma sessão.

Este documento existe para deixar visual o que está espalhado em texto nos dois módulos: como o
Radar de Eventos e as Métricas Agregadas se conectam, **em que ordem cada peça deve ser
construída**, e com que frequência cada parte roda em produção. Se você está pegando este módulo
para implementar, comece pela seção 1 — ela é a ordem de trabalho, não só um diagrama decorativo.

## 1. Ordem de implementação e dependências entre módulos

> Lê-se de cima para baixo, esquerda para direita. Cada caixa numerada (1.1–1.6) é uma sessão de
> implementação própria (uma spec por sessão, skill `spec-driven-dev`) — não pular etapa, cada uma
> consome a saída da anterior. Ver [overview.md](overview.md), "Ordem de implementação (dentro do
> módulo)" para a mesma ordem em prosa.

```mermaid
flowchart TD
    subgraph PRE["Pré-requisito — já implementado"]
        FOUND["foundation<br/>bw_query_metrics_daily/weekly/monthly/hourly<br/>bw_query_metrics_daily_by_platform<br/>narrative_metrics"]
    end

    subgraph RADAR["event-radar — construir nesta ordem, uma etapa por sessão"]
        direction TB
        R1["1.1 detection-engine (SQL)<br/>lê agregados de foundation<br/>escreve radar_staging_events"]
        R2["1.2 deduplication-grouping (SQL)<br/>lê/escreve radar_staging_events<br/>(upsert por chave de dedup + closed_at)"]
        R3["1.3 severity (SQL)<br/>escreve radar_staging_events.severity_score/severity"]
        R4["1.6 volume-limits (SQL)<br/>filtra radar_staging_events por cap diário<br/>(entra ANTES da IA, não depois)"]
        R5["1.4 agent-orchestrator (1 chamada IA/evento)<br/>lê radar_staging_events já filtrado"]
        R6["1.5 schema-integration<br/>escreve feed_events (+ cases se high/critical)<br/>+ feed_event_feedback"]
        R1 --> R2 --> R3 --> R4 --> R5 --> R6
    end

    subgraph AGG["aggregated-metrics — Fase B (só depois de R6 publicar eventos reais)"]
        direction TB
        A1["get_active_highlights<br/>SELECT filtrado em feed_events"]
        A2["risk_score = greatest(risk_score calculado, severity_score de evento ativo)<br/>(get_narratives_table)"]
        A3["ai-synthesis Camada 1<br/>2+ highlights → page_narrative_synthesis"]
        A1 --> A3
        A2 -.-> A3
    end

    FOUND --> R1
    R6 --> A1
    R6 --> A2
    A1 --> A3

    style PRE fill:#eaf3ea,stroke:#2e7d32
    style RADAR fill:#fdf1e0,stroke:#c07a00
    style AGG fill:#eaeefb,stroke:#3355aa
```

**O que já existe vs. o que este diagrama cobre**: `aggregated-metrics` (Fase A — `metrics`,
`breakdowns`, `trends`, `narratives` com `sentiment`/`momentum_score`/`trend_score`/`risk_score`
já calculados 100% a partir de `foundation`, `authors`, `graph`, `term_signals`) **já está
implementado e não aparece aqui** — ver `CLAUDE.md`, "aggregated-metrics module (Sprint 2)". Este
diagrama cobre só a parte que falta: o radar em si (R1–R6) e os três pontos onde, depois de
implementado, ele passa a alimentar `aggregated-metrics` (A1–A3, "Fase B").

**Tabelas por etapa** (ver [data-model.md](data-model.md) para o schema completo):

| Etapa | Lê | Escreve |
|---|---|---|
| 1.1 detection-engine | `bw_query_metrics_daily`/`weekly`/`monthly`/`hourly`/`_by_platform`, `narrative_metrics` | `radar_staging_events` (INSERT) |
| 1.2 deduplication-grouping | `radar_staging_events` (linhas novas) | `radar_staging_events` (UPDATE se já ativo, INSERT se novo, `closed_at` se encerrado) |
| 1.3 severity | `radar_staging_events` (ativos deduplicados) | `radar_staging_events.severity_score`/`severity` (UPDATE) |
| 1.6 volume-limits | `radar_staging_events` (candidatos com severidade), contagem do dia em `feed_events` | nenhuma (só filtra o que segue para 1.4) |
| 1.4 agent-orchestrator | `radar_staging_events` (já filtrado pelo cap) | via 1.5 |
| 1.5 schema-integration | saída estruturada do agent | `feed_events` (INSERT), `cases` (INSERT, só `high`/`critical`), `feed_event_feedback` (INSERT, assíncrono, vindo do analista) |
| A1 `get_active_highlights` | `feed_events` | nenhuma (leitura pura) |
| A2 `risk_score` boost | `feed_events`/`radar_staging_events.severity_score` (evento ativo da Narrativa) | nenhuma (calculado sob demanda em `get_narratives_table`) |
| A3 `ai-synthesis` Camada 1 | `feed_events.summary`/`explanation` (2+ highlights) | `page_narrative_synthesis` |

## 2. Sincronismo — quando cada parte roda

```mermaid
sequenceDiagram
    participant Cron as pg_cron
    participant Det as Motor de Detecção (1.1)
    participant Dedup as Dedup (1.2)
    participant Sev as Severidade (1.3)
    participant Cap as Cap diário (1.6)
    participant Agent as Orquestrador IA (1.4)
    participant Feed as feed_events (1.5)
    participant CC as cases (fila de aprovação)
    participant Edge as Edge Function de página
    participant Cache as page_cache (TTL 5min)
    participant Synth as Síntese (ai-synthesis)
    participant User as Usuário (frontend)

    Note over Cron,Feed: Roda a cada 15min, por organização (mesmo heartbeat de bw-sync)
    Cron->>Det: dispara checagem das janelas
    Det->>Dedup: eventos candidatos (staging)
    Dedup->>Sev: eventos únicos/ativos
    Sev->>Cap: eventos com severity_score
    Cap->>Agent: top N dentro do cap diário
    Agent->>Feed: should_publish=true → grava card
    Agent-->>CC: severity high/critical → caso pendente p/ aprovação
    CC-->>Feed: aprovado → publica

    Note over User,Edge: A qualquer momento, usuário abre uma página
    User->>Edge: GET /overview (ou outra página)
    Edge->>Cache: envelope em cache?
    alt cache válido (TTL 5min)
        Cache-->>Edge: envelope pronto (com highlights + narrative_text)
        Edge-->>User: responde na hora
    else cache expirado ou invalidado por novo sync
        Edge->>Feed: get_active_highlights (SELECT filtrado)
        Feed-->>Edge: highlights da página
        Edge->>Synth: 0-1 highlight → template / 2+ → composição cacheada
        Synth-->>Edge: narrative_text
        Edge->>Cache: grava envelope completo
        Edge-->>User: responde
    end

    Note over Cron,Feed: 1x/dia
    Cron->>Agent: resumo executivo em lote (últimas 72h)
    Agent->>Feed: publica resumo agregado
```

**Pontos de atenção no sincronismo:**

- O radar roda **independente** de qualquer usuário estar olhando a tela — ele é um cron
  contínuo. As páginas só leem o que já está pronto em `feed_events`.
- ✅ **`page_cache` já existe** (migration `20260725040000`, ver `CLAUDE.md`) — o TTL de 5min é
  real hoje; a invalidação antecipada (sync concluiu um ciclo / usuário clicou "Atualizar dados")
  ainda não está implementada (`_pending.md` gap #21) — evento novo do radar aparece na página só
  quando o TTL de 5min expirar naturalmente, não instantaneamente.
- A composição de `narrative_text` (quando há 2+ highlights) roda assíncrona e é cacheada em
  `page_narrative_synthesis` — nunca é recalculada a cada usuário que abre a página (ver
  [../aggregated-metrics/ai-synthesis.md](../aggregated-metrics/ai-synthesis.md)).

## 3. Os três (e apenas três) pontos de chamada de IA da plataforma

```mermaid
graph LR
    subgraph Ponto1["1. Orquestrador por evento (1.4)"]
        direction TB
        P1A["Frequência: por evento<br/>(deduplicado + com cap diário)"]
        P1B["Custo: ~10-20 chamadas/dia<br/>por organização, no máximo"]
    end

    subgraph Ponto2["2. Composição de página (ai-synthesis Camada 1)"]
        direction TB
        P2A["Frequência: cacheada por<br/>(org, página, período, filtros)"]
        P2B["Custo: nunca por carregamento<br/>de usuário — reusa texto do radar"]
    end

    subgraph Ponto3["3. Resumo executivo (1.4, modo lote)"]
        direction TB
        P3A["Frequência: 1x/dia, em lote"]
        P3B["Custo: 1 chamada agregando<br/>até 72h de cards publicados"]
    end

    style Ponto1 fill:#fdf1e0
    style Ponto2 fill:#eaeefb
    style Ponto3 fill:#f3eaf3
```

Qualquer chamada de IA fora desses três pontos precisa de justificativa explícita no spec
correspondente (regra já definida em `event-radar/overview.md` e `aggregated-metrics/ai-synthesis.md`).

## Referências

- [overview.md](overview.md) — "Ordem de implementação (dentro do módulo)", mesma sequência 1.1–1.6 em prosa
- [data-model.md](data-model.md) — schema completo de `radar_staging_events`/`feed_events`/`feed_event_feedback`
- [aggregated-metrics-integration.md](aggregated-metrics-integration.md) — contrato de campos ponto a ponto
- [../aggregated-metrics/overview.md](../aggregated-metrics/overview.md)
- [../aggregated-metrics/ai-synthesis.md](../aggregated-metrics/ai-synthesis.md)
- [../aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md)
