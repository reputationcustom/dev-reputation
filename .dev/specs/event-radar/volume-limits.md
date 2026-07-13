---
tipo: feature-spec
módulo: event-radar
funcionalidade: volume-limits
status: rascunho
atualizado: 2026-07-25
---

# Limites de Volume

## Objetivo

Evitar que o volume de eventos detectados vire ruído (e custo de IA desnecessário) limitando
quantos eventos são publicados por organização por dia.

## Regras de negócio

- Cap de aproximadamente 10-20 eventos publicados por dia por organização.
- O corte é uma regra SQL aplicada **antes** de enfileirar para a IA (etapa 1.4) — nunca depois.
  Isso corta o custo direto na origem, não depois de já ter pago pela chamada.
- Quando há mais eventos candidatos do que o cap permite, priorizar por `severity_score` desc
  (calculado em 1.3) — os eventos mais severos entram na fila da IA primeiro.
- Este mesmo cap é o que limita quantos itens o bloco `highlights` do envelope de
  `aggregated-metrics` pode retornar por página — não existe um segundo limite lá. Ver
  [aggregated-metrics-integration.md](aggregated-metrics-integration.md).

## Dados envolvidos

- **Lê**: `radar_staging_events` (candidatos deduplicados, com severidade), contagem de eventos
  já publicados no dia corrente por organização.
- **Escreve**: nenhuma tabela nova — apenas filtra o que segue para 1.4.

## Referências relacionadas

- [overview.md](overview.md)
- [data-model.md](data-model.md)
- [severity.md](severity.md)
- [agent-orchestrator.md](agent-orchestrator.md)
