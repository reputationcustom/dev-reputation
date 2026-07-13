---
tipo: feature-spec
módulo: event-radar
funcionalidade: deduplication-grouping
status: rascunho
atualizado: 2026-07-25
---

# Deduplicação e Agrupamento Determinístico (SQL, sem IA)

## Objetivo

Garantir que nenhum evento chegue à IA (etapa 1.4) duas vezes, e que eventos ativos sejam
atualizados em vez de recriados — tudo antes de qualquer custo de token.

## Fluxo principal

1. Roda sobre as linhas novas de `radar_staging_events`.
2. Para cada linha, calcula a chave de dedup: `organization_id + scope_type + scope_id +
   event_type + window` (ver `detection-engine.md` para o significado de `scope_type`/`scope_id`
   — nunca "entity", termo reservado para `entities`).
3. Se já existe um evento ativo com essa chave: `UPDATE` (atualiza métricas, mantém o mesmo
   registro/id).
4. Se não existe: `INSERT` como novo evento ativo.
5. Quando o indicador que originou o evento volta ao normal (deixa de disparar a regra na
   checagem seguinte): marca o evento como encerrado (`closed_at`).

## Regras de negócio

- `UNIQUE` constraint na chave de dedup para eventos com status ativo — a lógica de upsert deve
  se apoiar nessa constraint, não em verificação manual em código.
- Esta etapa roda **sempre antes** de qualquer chamada à etapa 1.4 (orquestrador). Nenhum evento
  deduplicado incorretamente deve chegar à IA.
- Encerramento automático: se um evento ativo não é mais detectado na checagem seguinte do motor
  (1.1), ele é fechado aqui — isso também evita que o Intelligent Feed acumule cards obsoletos.

## Dados envolvidos

- **Lê**: `radar_staging_events` (linhas novas desde a última execução).
- **Escreve**: `radar_staging_events` (UPDATE de eventos ativos existentes, INSERT de novos,
  `closed_at` em eventos encerrados).

## Referências relacionadas

- [overview.md](overview.md)
- [data-model.md](data-model.md) — schema completo de `radar_staging_events` (incl. `closed_at`)
- [detection-engine.md](detection-engine.md)
- [severity.md](severity.md)
