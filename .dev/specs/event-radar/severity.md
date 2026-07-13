---
tipo: feature-spec
módulo: event-radar
funcionalidade: severity
status: rascunho
atualizado: 2026-07-22
---

# Severidade (SQL, sem IA)

## Objetivo

Calcular um score contínuo e determinístico de 0 a 100 para cada evento deduplicado, e mapear
esse score para a categoria de risco já existente no schema (`low`/`medium`/`high`/`critical`).

## Fluxo principal

1. Roda sobre eventos ativos e deduplicados (saída de 1.2).
2. Calcula o score ponderado (ver pesos abaixo).
3. Mapeia o score para a categoria oficial de risco.
4. Grava `severity_score` (bruto) e `severity` (categoria) no evento.

## Pesos do score (MVP)

| Fator                              | Peso |
|--------------------------------------|------|
| Volume                                | 20%  |
| Sentimento                            | 20%  |
| Velocidade                            | 20%  |
| Alcance/engajamento                   | 15%  |
| Relevância dos autores envolvidos     | 10%  |
| Risco da narrativa relacionada        | 10%  |
| Persistência (há quanto tempo ativo)  | 5%   |

## Relação com `risk_score` (`aggregated-metrics`)

> ✅ Atualizado 2026-07-13 — antes desta revisão, esta seção dizia que
> `severity_score` era reaproveitado como `momentum_score`. Isso mudou:
> Momentum foi redefinido em
> [../aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md)
> como um índice puro de crescimento (volume/engajamento/autores/alcance),
> sem relação com evento detectado — e um novo `risk_score` (prioridade
> operacional) foi introduzido, com pesos muito mais parecidos aos de
> `severity_score` (volume/sentimento/velocidade/alcance/autores/persistência)
> do que os de Momentum.
>
> ⚠️ **Nota (2026-07-22)**: o indicador de Narrativa antes chamado
> "Velocidade" (`get_narratives_table().velocity_score`, snapshot 3h-vs-3h)
> foi substituído por "Tendência" (`trend_score`, regressão estatística de
> 14 dias) — ver `sql-aggregation.md`, "Tendência". O fator "Velocidade" da
> tabela de pesos acima **não** foi renomeado junto: este módulo ainda é
> `rascunho`/não implementado, e o fator aqui é conceitualmente sobre a
> rapidez de escalada do **evento** detectado (janela curta, mais próximo
> do desenho antigo de Velocidade do que da nova regressão de 14 dias da
> Narrativa) — decisão de nome/fórmula fica para quando `event-radar` for
> de fato especificado/implementado, não decidida por tabela aqui.

`severity_score` (por evento, só existe enquanto há um evento ativo pra
aquela Narrativa) e `risk_score` (por Narrativa, sempre calculado, ver
`aggregated-metrics/sql-aggregation.md`) são **scores irmãos, não o mesmo
número** — um é sobre um evento transiente detectado, o outro é uma
prioridade contínua da Narrativa. `aggregated-metrics` decide como
combiná-los (ex: usar o maior dos dois, ou uma média ponderada quando há
evento ativo) — essa combinação fica registrada em
[aggregated-metrics-integration.md](aggregated-metrics-integration.md),
não aqui, pra não duplicar a mesma decisão em dois arquivos.

## Regras de negócio

- A categoria (`low`/`medium`/`high`/`critical`) é o **campo oficial** de risco — não criar uma
  segunda escala de risco em paralelo à já existente no schema. `severity_score` bruto é
  persistido apenas para ordenação e transparência (ex: ordenar highlights por severidade dentro
  da mesma categoria).
- Nenhuma chamada de IA acontece nesta etapa.

## Dados envolvidos

- **Lê**: `radar_staging_events` (eventos ativos deduplicados), dados agregados de
  alcance/engajamento/autores necessários para os pesos acima.
- **Escreve**: `radar_staging_events.severity_score`, `radar_staging_events.severity`
  (UPDATE).

## Referências relacionadas

- [overview.md](overview.md)
- [deduplication-grouping.md](deduplication-grouping.md)
- [agent-orchestrator.md](agent-orchestrator.md)
- [aggregated-metrics-integration.md](aggregated-metrics-integration.md)
