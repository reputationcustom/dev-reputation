---
tipo: feature-spec
módulo: event-radar
funcionalidade: schema-integration
status: rascunho
atualizado: 2026-07-12
---

# Integração com o Schema Existente

## Objetivo

Definir onde e como a saída do orquestrador (1.4) é persistida, reaproveitando as estruturas já
existentes no schema (`feed_events`, `cases`) em vez de criar tabelas novas.

## Fluxo principal

1. Evento aprovado (`should_publish: true`) é gravado em `feed_events`, com um
   tipo/tag de evento `"radar"` para diferenciá-lo de outras origens da mesma tabela.
2. Se `severity` for `high` ou `critical`: cria uma linha pendente em `cases`
   (`intelligence-center/data-model.md`), aguardando aprovação humana antes de publicar de fato
   para os usuários finais. ⚠️ DECISÃO PENDENTE: `cases` hoje é somente-leitura (ver
   `intelligence-center/data-model.md`) — este fluxo precisa de uma UI de aprovação (aceitar/
   rejeitar) que ainda não tem spec própria; não bloqueia o resto de `event-radar`, mas bloqueia
   este passo específico até existir.
3. Se `severity` for `low` ou `medium`/informativa: publica direto, sem aprovação manual.
4. Quando o analista dá feedback sobre um card (útil / irrelevante / severidade errada /
   explicação incorreta), grava em uma tabela de feedback vinculada ao `event_id`.

## Regras de negócio

- **Não criar uma tabela `radar_events` nova.** Reaproveitar `feed_events`, filtrando por
  tipo/tag de evento.
- Aprovação humana é obrigatória para `high`/`critical` — o sistema não deve
  publicar esses direto para o feed sem esse passo (ver ⚠️ DECISÃO PENDENTE acima).
- O feedback do analista é armazenamento e agregação simples — **sem IA nesta etapa**. Serve
  para ajuste futuro de thresholds por organização (fora do escopo deste MVP, mas o dado deve
  ser coletado desde já).

## Dados envolvidos

- **Lê**: saída estruturada do orquestrador (1.4).
- **Escreve**:
  - `feed_events` (INSERT, tipo/tag `"radar"`)
  - `cases` — linha pendente (INSERT), apenas para `severity` `high`/`critical` (ver ⚠️ DECISÃO PENDENTE acima)
  - Tabela de feedback do analista (INSERT), vinculada por `event_id` a `feed_events`

## Permissões

| Ação                                        | Quem pode                         |
|-----------------------------------------------|--------------------------------------|
| Aprovar/rejeitar caso pendente             | analista com permissão na organização (UI ainda sem spec, ver acima) |
| Dar feedback em um card do feed                | qualquer usuário autenticado da organização |

## Referências relacionadas

- [overview.md](overview.md)
- [agent-orchestrator.md](agent-orchestrator.md)
- [aggregated-metrics-integration.md](aggregated-metrics-integration.md)
