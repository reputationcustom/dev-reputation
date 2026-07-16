---
tipo: feature-spec
módulo: event-radar
funcionalidade: deduplication-grouping
status: implementado
atualizado: 2026-07-28
---

# Deduplicação e Agrupamento Determinístico (SQL, sem IA)

> ✅ **Implementado (2026-07-28)** — migration
> `20260728000000_event_radar_deduplication_grouping.sql`. Pedido do
> usuário: promover este spec de `rascunho` pra `pronto` e implementar em
> seguida — na prática, ao terminar o código, o status já vai direto pra
> `implementado` (mesmo padrão de `detection-engine.md`), sem ficar parado
> em `pronto`.
>
> ⚠️ **Achado ao implementar**: metade deste spec (itens 2-4 do "Fluxo
> principal" — inserir se a chave de dedup não existe ativa, atualizar se
> já existe) **já estava implementada desde 1.1**
> (`20260727000000_event_radar_detection_engine.sql`) — o próprio
> `run_event_detection()` já faz isso via `INSERT ... ON CONFLICT (...)
> WHERE closed_at IS NULL DO UPDATE` sobre a mesma chave de dedup que este
> spec descreve. Não existe uma segunda camada de dedup escrita nesta
> migration em cima disso — seria redundante. A peça genuinamente nova
> (item 5 — encerramento automático quando o indicador volta ao normal)
> foi adicionada dentro do próprio `run_event_detection()` (`CREATE OR
> REPLACE`), não como uma função/step separado: "voltou ao normal" só é
> conhecível comparando contra a mesma varredura de regras que 1.1 já
> calcula a cada ciclo — uma função separada precisaria recalcular a mesma
> matriz de agregações só pra descobrir a mesma coisa, dobrando o custo de
> leitura sem benefício. Mecanismo: `v_cycle_start` (capturado uma vez no
> início do ciclo, usado como valor de `detected_at` em todo INSERT/UPDATE
> que antes usava `now()` diretamente) permite, ao final do ciclo, fechar
> numa única instrução (`UPDATE ... WHERE closed_at IS NULL AND detected_at
> < v_cycle_start`) qualquer linha ativa que não foi tocada nesta
> varredura — ou seja, cuja regra deixou de disparar. Seguro porque
> `run_event_detection()` reavalia **todas** as 13 combinações regra×janela
> por completo a cada ciclo (sem execução faseada, diferente de
> `bw-sync`), então "não foi tocada" tem exatamente um significado: a regra
> parou de valer.

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
