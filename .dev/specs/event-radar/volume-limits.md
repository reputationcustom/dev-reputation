---
tipo: feature-spec
módulo: event-radar
funcionalidade: volume-limits
status: implementado
atualizado: 2026-07-30
---

# Limites de Volume

> ✅ **Implementado (2026-07-30)** — migration
> `20260730000000_event_radar_volume_limits.sql`, anexado dentro do
> próprio `run_event_detection()` (mais um `CREATE OR REPLACE`, não uma
> função/pg_cron separado — mesma razão de 1.2/1.3: evita depender de
> ordem entre dois jobs de `pg_cron` agendados pro mesmo horário).
>
> ⚠️ **Implementado antes de 1.4, não depois** — apesar do número "1.6"
> vir depois de "1.4" na lista de funcionalidades, `overview.md`, "Ordem
> de implementação" já dizia explicitamente que este filtro "entra... entre
> 1.3 e 1.4", e o próprio `agent-orchestrator.md` já assume "dentro do cap
> diário" como pré-condição do seu "Fluxo principal". A numeração é só
> rótulo de catálogo, não ordem de execução.
>
> Cap fixado em **15** (ponto médio do "aproximadamente 10-20" pedido
> aqui), em `event_radar_config().daily_event_cap` — mesmo lugar/mesma
> convenção dos outros thresholds de MVP inferidos em 1.1.
> Coluna nova, não antecipada em `data-model.md`:
> `radar_staging_events.queued_for_agent_at` — sem `feed_events` existir
> ainda (1.5 não implementado), não havia nenhuma fonte pra saber "quantos
> eventos já foram considerados hoje"; e mesmo que `feed_events` existisse,
> o corte tem que acontecer *antes* da chamada de IA, não poderia ser
> inferido a partir do que já foi publicado. Marcado nos eventos ativos
> ainda não marcados hoje (UTC), até o cap, priorizando por
> `severity_score` desc — uma futura Edge Function de 1.4 deve ler
> `queued_for_agent_at is not null` para saber o que processar, nunca
> reimplementar o cap por conta própria.

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
