---
tipo: feature-spec
módulo: event-radar
funcionalidade: schema-integration
status: rascunho
atualizado: 2026-07-25
---

# Integração com o Schema Existente

## Objetivo

Definir onde e como a saída do orquestrador (1.4) é persistida, reaproveitando a estrutura já
existente no schema (`feed_events`) em vez de criar tabelas novas.

## Fluxo principal

1. Evento aprovado pela IA (`should_publish: true`) é gravado em `feed_events` — **qualquer
   `severity`, incluindo `high`/`critical`, publica direto, sem aprovação humana intermediária**
   (✅ decisão do usuário, 2026-07-25 — remove a trava de aprovação manual que uma revisão
   anterior desta spec previa via `cases`). `type` recebe o valor de `feed_event_type` mais
   próximo da categoria da regra (`threshold_triggered` para regras de volume/z-score,
   `sentiment_changed` para regras de sentimento), e a nova coluna `event_type` (texto livre, ver
   [data-model.md](data-model.md)) recebe o rótulo granular exato da regra que disparou
   (`volume_spike`, `sentiment_change` etc.) — é essa segunda coluna que diferencia este evento de
   outras origens da mesma tabela e que o bloco `highlights` do envelope lê para exibir o tipo
   exato do card.
2. Quando o analista dá feedback sobre um card já publicado (útil / irrelevante / severidade
   errada / explicação incorreta), grava em `feed_event_feedback` (ver [data-model.md](data-model.md)),
   vinculada por `feed_event_id` — esse feedback é sempre **pós-publicação**, nunca um gate antes
   de publicar.

## Regras de negócio

- **Não criar uma tabela `radar_events` nova.** Reaproveitar `feed_events`, filtrando por
  `type`/`event_type`.
- Nenhuma severidade passa por aprovação humana antes de publicar — `severity`/`severity_score`
  já refletem o julgamento determinístico da etapa 1.3, e o `should_publish`/`confidence` da IA
  (1.4) já é o filtro de qualidade antes da gravação. Um evento `high`/`critical` chega ao feed
  mais rápido por ser justamente o que a equipe de comunicação mais precisa ver cedo.
- O feedback do analista é armazenamento e agregação simples — **sem IA nesta etapa**. Serve
  para ajuste futuro de thresholds por organização (fora do escopo deste MVP, mas o dado deve
  ser coletado desde já) — inclusive para recalibrar `severity`/`should_publish` se a equipe
  achar que um evento `high`/`critical` real não deveria ter sido tão fácil de publicar.

## Dados envolvidos

- **Lê**: saída estruturada do orquestrador (1.4).
- **Escreve**:
  - `feed_events` (INSERT — `type` + `event_type` granular, ver "Fluxo principal" item 1 e [data-model.md](data-model.md)), qualquer `severity`
  - `feed_event_feedback` (INSERT), vinculada por `feed_event_id` a `feed_events`

## Permissões

| Ação                                        | Quem pode                         |
|-----------------------------------------------|--------------------------------------|
| Dar feedback em um card do feed                | qualquer usuário autenticado da organização |

## Referências relacionadas

- [overview.md](overview.md)
- [data-model.md](data-model.md)
- [agent-orchestrator.md](agent-orchestrator.md)
- [aggregated-metrics-integration.md](aggregated-metrics-integration.md)
