---
tipo: feature-spec
módulo: event-radar
funcionalidade: aggregated-metrics-integration
status: implementado
atualizado: 2026-08-02
---

# Integração com `aggregated-metrics`

> ✅ **Implementado (2026-08-02, "Fase B" de `fluxo-aggregated-metrics.md`,
> migrations `20260802010000`/`20260802020000`)** — os 5 pontos de contrato
> abaixo estão todos em código: `get_active_highlights` (ponto 1), nomes de
> campo idênticos entre `AgentOutput`/`Highlight` (ponto 2, inalterado desde
> 1.4), Camada 0/1 de `ai-synthesis.md` implementadas (ponto 3),
> `risk_score = greatest(...)` em `get_narratives_table` (ponto 4, texto
> abaixo já descrevia exatamente o que foi implementado), cap diário
> compartilhado (ponto 5, inalterado desde 1.6). Nenhum texto deste arquivo
> precisou mudar além do status — a spec já descrevia com precisão o que
> viria a ser construído. Ver `CLAUDE.md`, "Fase B implementada", e
> `aggregated-metrics/sql-aggregation.md`, "Risco".

## Objetivo

Documentar explicitamente o contrato entre este módulo e `aggregated-metrics`, já que os dois
foram especificados em momentos diferentes e precisam ficar sincronizados. Este é o spec que
qualquer PR que altere o formato de saída de um dos dois módulos deve revisar.

## Pontos de contrato

1. **`highlights` do envelope = leitura filtrada de `feed_events`.**
   `aggregated-metrics` não recalcula nem reanalisa nada — só faz `SELECT` com filtro de
   organização/período/escopo da página, ordenado por `severity_score`. Ver
   `.dev/specs/aggregated-metrics/sql-aggregation.md` (`get_active_highlights`).

2. **Os nomes de campo do schema de saída do orquestrador (1.4) são os mesmos usados no bloco
   `highlights` do envelope.** `title`, `summary`, `explanation`, `recommendation`, `severity`,
   `severity_score`, `confidence`, `tags`. Se um nome mudar aqui, `standard-json-envelope.md` do
   outro módulo precisa mudar na mesma PR.

3. **`narrative_text` de cada página é montado a partir do `summary`/`explanation` dos
   highlights já publicados por este radar** — `aggregated-metrics` não faz uma nova análise
   via IA para "explicar a página". Ver `.dev/specs/aggregated-metrics/ai-synthesis.md`.

4. ✅ **Atualizado 2026-07-13**: `narratives[].momentum_score` **não** reaproveita mais
   `severity_score` — Momentum foi redefinido como um índice de crescimento puro
   (volume/engajamento/autores/alcance), independente de evento detectado, ver
   [../aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md), "Scores
   de Narrativa". No lugar, `narratives[].risk_score` (novo campo do envelope, ver
   [severity.md](severity.md), "Relação com `risk_score`") é o que considera `severity_score`
   quando a narrativa tem evento ativo — `risk_score = greatest(risk_score calculado, severity_score
   do evento ativo, se houver)`. Um evento detectado pelo radar nunca deve fazer o `risk_score`
   de uma Narrativa **cair** — só pode elevá-lo ou não mudar nada.

5. **O cap diário de eventos** ([volume-limits.md](volume-limits.md)) é o mesmo limite que
   define quantos itens aparecem no bloco `highlights` de uma página — não há um segundo cap.

## Ordem de implementação entre os dois módulos

> Ver diagrama completo em
> [fluxo-aggregated-metrics.md](fluxo-aggregated-metrics.md).

1. `aggregated-metrics` pode ser implementado e entregue **completo** sem este módulo —
   `metrics`, `breakdowns`, `trends`, `authors`, `graph`, `term_signals` e a tabela `narratives`
   (incl. `sentiment`/`momentum_score`/`trend_score` (antes `velocity_score`, ver
   `sql-aggregation.md`, "Tendência")/`risk_score`, todos calculados 100% a
   partir de `foundation`, sem depender de `event-radar`) não dependem deste módulo.
2. `highlights`, `narrative_text` e o boost de `risk_score` via evento ativo ficam vazios/em
   fallback até este módulo estar publicando em `feed_events`.
3. Depois que `event-radar` estiver implementado e publicando eventos reais, uma segunda
   passada em `aggregated-metrics` conecta `get_active_highlights`, a camada 0/1 de
   `ai-synthesis.md`, e o boost de `risk_score` via `severity_score`.

## Regras de negócio

- Qualquer alteração de schema de saída (1.4) deve ser revisada contra
  `standard-json-envelope.md` do outro módulo antes de merge.
- `aggregated-metrics` nunca deve reimplementar regras de detecção, dedup ou severidade — se um
  bloco `highlights` parecer incompleto, o ajuste é neste módulo (thresholds, regras), nunca uma
  lógica duplicada no outro.

## Referências relacionadas

- [overview.md](overview.md)
- [data-model.md](data-model.md)
- [agent-orchestrator.md](agent-orchestrator.md)
- [severity.md](severity.md)
- [volume-limits.md](volume-limits.md)
- [../aggregated-metrics/standard-json-envelope.md](../aggregated-metrics/standard-json-envelope.md)
- [../aggregated-metrics/ai-synthesis.md](../aggregated-metrics/ai-synthesis.md)
- [../aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md)
