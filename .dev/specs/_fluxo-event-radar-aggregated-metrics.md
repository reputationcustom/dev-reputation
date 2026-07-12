---
tipo: cross-module-flow
módulos: [event-radar, aggregated-metrics]
atualizado: 2026-07-12
---

# Fluxo e Sincronismo — Radar de Eventos ↔ Métricas Agregadas

Este documento existe para deixar visual o que está espalhado em texto nos dois módulos:
como o Radar de Eventos e as Métricas Agregadas se conectam, em que ordem devem ser
implementados, e com que frequência cada parte roda.

## 1. Dependência entre módulos e ordem de implementação

```mermaid
graph TD
    A[foundation: sync-brandwatch<br/>já implementado] --> B[foundation: narratives<br/>já implementado]
    B --> C1

    subgraph FASE_A["Fase A — pode começar já"]
        C1[aggregated-metrics<br/>envelope + SQL base]
        C2[metrics / breakdowns / trends]
        C3[narratives sem momentum real<br/>authors / graph / term_signals]
        C1 --> C2
        C1 --> C3
    end

    subgraph FASE_RADAR["event-radar — implementar em sequência"]
        D1["1.1 detection-engine<br/>(SQL)"]
        D2["1.2 deduplication-grouping<br/>(SQL)"]
        D3["1.3 severity<br/>(SQL)"]
        D4["1.6 volume-limits<br/>(SQL, filtro antes da IA)"]
        D5["1.4 agent-orchestrator<br/>(1 chamada IA/evento)"]
        D6["1.5 schema-integration<br/>feed_events + cases"]
        D1 --> D2 --> D3 --> D4 --> D5 --> D6
    end

    B --> D1

    subgraph FASE_B["Fase B — só depois do radar publicar eventos reais"]
        E1[get_active_highlights liga em feed_events]
        E2[momentum_score liga em severity_score]
        E3[ai-synthesis camadas 0/1/2]
        E1 --> E3
        E2 --> E3
    end

    D6 --> E1
    D6 --> E2
    C3 --> E2
    E3 --> F[Frontend — 8 páginas do protótipo]
    C2 --> F
    C3 --> F

    style FASE_A fill:#eaf3ea
    style FASE_RADAR fill:#fdf1e0
    style FASE_B fill:#eaeefb
```

**Leitura prática**: `aggregated-metrics` (Fase A) e `event-radar` podem ser desenvolvidos em
paralelo por pessoas/sessões diferentes — a Fase A não trava esperando o radar. O que trava é
só a Fase B (highlights, narrative_text, momentum real), que só liga depois que
`event-radar` (1.1 → 1.6) estiver publicando eventos de verdade em `feed_events`.

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
    participant Cache as Cache do envelope
    participant Synth as Síntese (ai-synthesis)
    participant User as Usuário (frontend)

    Note over Cron,Feed: Roda a cada 15-30min, por organização
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
- O cache do envelope (TTL 5min) é invalidado antes do prazo quando: (a) um ciclo de sync da
  Brandwatch termina, ou (b) o usuário clica em "Atualizar dados". Ele NÃO é invalidado a cada
  novo evento do radar isoladamente — senão o cache perderia o sentido. Evento novo aparece na
  página no próximo ciclo de cache normal.
- A composição de `narrative_text` (quando há 2+ highlights) roda assíncrona e é cacheada junto
  do envelope — nunca é recalculada a cada usuário que abre a página.

## 3. Os três (e apenas três) pontos de chamada de IA da plataforma

```mermaid
graph LR
    subgraph Ponto1["1. Orquestrador por evento"]
        direction TB
        P1A["Frequência: por evento<br/>(deduplicado + com cap diário)"]
        P1B["Custo: ~10-20 chamadas/dia<br/>por organização, no máximo"]
    end

    subgraph Ponto2["2. Composição de página"]
        direction TB
        P2A["Frequência: cacheada por<br/>(org, página, período, filtros)"]
        P2B["Custo: nunca por carregamento<br/>de usuário — reusa texto do radar"]
    end

    subgraph Ponto3["3. Resumo executivo"]
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

- [event-radar/overview.md](event-radar/overview.md)
- [event-radar/aggregated-metrics-integration.md](event-radar/aggregated-metrics-integration.md)
- [aggregated-metrics/overview.md](aggregated-metrics/overview.md)
- [aggregated-metrics/ai-synthesis.md](aggregated-metrics/ai-synthesis.md)
