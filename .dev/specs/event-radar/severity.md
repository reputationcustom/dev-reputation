---
tipo: feature-spec
módulo: event-radar
funcionalidade: severity
status: implementado
atualizado: 2026-08-08
---

# Severidade (SQL, sem IA)

> ✅ **Implementado (2026-07-29)** — migration
> `20260729000000_event_radar_severity.sql`. Anexado dentro do próprio
> `run_event_detection()` (mais um `CREATE OR REPLACE`, não uma função/
> pg_cron separado) pela mesma razão que 1.2 foi: dois jobs agendados pro
> mesmo horário de `pg_cron` não têm ordem garantida entre si, o que
> deixaria a severidade até 15min desatualizada em relação à
> detecção/fechamento mais recente — evitável sem custo real, já que 1.3
> só precisa rodar depois de 1.1/1.2 gravarem na mesma transação.
>
> ⚠️ Nenhuma fórmula exata é dada abaixo pra cada fator (só os pesos) —
> cada fator tem sua própria inferência de MVP documentada na migration
> (`event_radar_volume_severity`/`_sentiment_severity`/`_velocity_severity`/
> `_reach_engagement_severity`/`_author_influence_severity`/
> `_related_narrative_risk`), reaproveitando o máximo possível do que 1.1
> já calcula (z-scores de `event_radar_hourly_zscore`, janelas de
> `event_radar_hourly_symmetric`/`event_radar_daily_range`) em vez de
> inventar uma segunda fonte. Fator ausente pro escopo (ex: `platform` não
> tem breakdown de autores nem "narrativa relacionada", `platform` só tem
> `negative_share` via fallback nenhum) retorna `null` — `coalesce(fator,
> 50)` no cálculo final, 50 = neutro, mesma convenção de `norm_growth`
> (`aggregated-metrics/sql-aggregation.md`). Mapeamento score→categoria
> reaproveita as 4 faixas exatas de `risk_score` (0-33 low, 34-59 medium,
> 60-84 high, 85-100 critical) — "não criar uma segunda escala de risco em
> paralelo", como pedido abaixo em "Regras de negócio".

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

> ⚠️ **Nota (2026-08-07), corrigida no dia seguinte** — dizia aqui que a
> regra `momentum_spike` "não muda esta fórmula de severidade... um evento
> `momentum_spike` é severidade-calculado exatamente como qualquer outro".
> Isso se revelou um problema real, não uma decisão neutra: o fator
> "Velocidade" (20% do peso) sempre recalcula uma janela **fixa de
> 3h-vs-3h**, totalmente desconectada da janela "3d"/do sinal que
> `momentum_spike` de fato detecta. Um card de Momentum "Explosivo" cujo
> crescimento já tinha acontecido mais cedo na janela de 3 dias (volume já
> estabilizado num platô alto nas últimas 3h) recomputava "Velocidade"
> perto de **zero** — não neutro (50), um valor real e baixo — no exato
> fator de 20% que deveria refletir a força do sinal do evento. Achado via
> screenshot real do usuário: card com "crescimento de mais de 1.000% em
> volume de menções nos últimos 3 dias" e tag "momentum_crescente"
> renderizando `severity = 'high'` (78), não `'critical'` — "tenho um
> event é critico momentum alto e não ficou vermelho".
>
> ✅ **Corrigido (2026-08-08, migration
> `20260808000000_event_radar_severity_velocity_momentum_alignment.sql`)**:
> `event_radar_velocity_severity()` ganhou `p_event_type`/`p_metric_value`
> — quando o evento é `momentum_spike`, o fator "Velocidade" passa a ser o
> próprio `momentum_score` já calculado na detecção (`radar_staging_events.
> metric_value`, já 0-100, escala idêntica à do fator) em vez de
> recalcular um 3h-vs-3h sem relação com o sinal real. Para todo outro
> `event_type`, o comportamento é idêntico a antes — nenhuma mudança de
> severidade fora de `momentum_spike`. O fator "Risco da narrativa
> relacionada" (10%, via `risk_score`, que embute Momentum a 25%
> amortecido) continua sendo um caminho indireto adicional, agora somado a
> este caminho direto e muito mais forte.

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
- [data-model.md](data-model.md)
- [deduplication-grouping.md](deduplication-grouping.md)
- [agent-orchestrator.md](agent-orchestrator.md)
- [aggregated-metrics-integration.md](aggregated-metrics-integration.md)
