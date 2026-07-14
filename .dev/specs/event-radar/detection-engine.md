---
tipo: feature-spec
módulo: event-radar
funcionalidade: detection-engine
status: implementado
atualizado: 2026-08-07
---

# Motor de Detecção (100% SQL, sem IA)

> ✅ **Implementado (2026-07-27)** — migration
> `20260727000000_event_radar_detection_engine.sql`: tabela
> `radar_staging_events` (schema exato de `data-model.md`) +
> `run_event_detection()` agendada via `pg_cron` a cada 15 minutos (item 1
> deste "Fluxo principal", já resolvido em 2026-07-22). Cobre as 5 janelas
> e os 5 `event_type` de exemplo listados abaixo — mapeamento janela↔regra é
> uma escolha de MVP não especificada em nenhum lugar deste arquivo,
> documentada inline na migration e em `CLAUDE.md` ("Módulo `event-radar`").
> Thresholds (variação %, volume mínimo, diferença absoluta de sentimento
> negativo) também não tinham número exato definido aqui — só a banda de
> z-score (≥2/≥3) é explícita — inferência de MVP em
> `event_radar_config()`, revisar com dado real de produção. Escopo
> `platform` não roda as 2 regras de sentimento negativo
> (`negative_sentiment_increase`/`negative_sentiment_spike`) — não existe
> breakdown positivo/neutro/negativo em `bw_query_metrics_daily_by_platform`,
> só o score composto (gap honesto, ver `CLAUDE.md`). Etapas 1.2–1.6
> (dedup, severidade, agent, escrita em `feed_events`, cap de volume)
> continuam rascunho — esta função só grava em `radar_staging_events`.
>
> ✅ **Sexto `event_type`, `momentum_spike` (2026-08-07)** — migration
> `20260807000000_event_radar_momentum_detection.sql`. Achado do usuário:
> "não me parece que está sendo considerado o momentum... existem algumas
> narrativas que tem o momento explosivo e que não gerou nenhum evento no
> radar" — confirmado como gap real, não impressão: as 5 regras acima só
> leem volume bruto/sentimento (`bw_query_metrics_hourly`/`daily`/
> `narrative_metrics`), nunca `momentum_score`
> (`aggregated-metrics/sql-aggregation.md`, "Momentum" — índice composto de
> crescimento de volume/engajamento/autores/alcance). A etapa 1.3
> (`severity.md`) só toca Momentum indiretamente (fator "Risco da narrativa
> relacionada", 10%, via `risk_score` — que já embute Momentum a 25%) e só
> depois que um evento já foi detectado por outra regra — uma Narrativa com
> Momentum "Explosivo" (≥80) sem pico de volume bruto correspondente nunca
> gerava evento algum. Isso era uma decisão deliberada
> (`_pending.md` gap #32, 2026-07-24: "momentum_score já representa esse
> sinal bem o suficiente, sem precisar de uma regra de detecção própria em
> event-radar") — revertida nesta sessão a pedido do usuário. Nova regra:
> `event_type = 'momentum_spike'`, escopo **só `narrative`** (Momentum como
> score de produto só existe pra Narrativa), janela `3d` (reaproveitada, não
> uma janela nova), reaproveitando a MESMA fórmula/pesos de Momentum já em
> produção via `event_radar_narrative_momentum()` (0.40 volume + 0.25
> engajamento + 0.20 autores + 0.15 alcance, `norm_growth`) — nunca uma
> segunda fórmula divergente. Threshold reaproveita a própria faixa
> "Explosivo" (≥80) já definida em `sql-aggregation.md`. Ver o comentário no
> topo da migration para a guarda anti-falso-positivo adicionada (Narrativa
> sem dado do período atual ainda sincronizado não pode ser lida como
> "crescimento explosivo" por artefato de `norm_growth(null, valor_real)`
> resolvendo pra 100).
>
> ⚠️ **Esclarecimento de nomenclatura**, resposta à pergunta do usuário
> "substituímos velocidade por momentum, verifique se isso está correto":
> não foi isso que aconteceu. Em 2026-07-22 (`20260722010000`) "Velocidade"
> (score de Narrativa, snapshot 3h-vs-3h) foi substituída por "Tendência"
> (`trend_score`, regressão de 14 dias) — Momentum nunca foi tocado, sempre
> existiu como um quarto score separado (pedido explícito do usuário na
> época: "os indicadores se mantém como risk_score e momentum"). São dois
> fatos distintos que a pergunta original conflava.

## Objetivo

Calcular, de forma puramente estatística, quando o comportamento das menções de uma
organização mudou o suficiente para virar um evento candidato — sem nenhuma chamada de IA
nesta etapa, e sem nenhuma agregação local sobre `mentions` (ver "Dados envolvidos" abaixo —
mesma premissa de `_index.md`/`CLAUDE.md`, já fixada depois de um bug real de produção com SOV
calculado por soma local sobre uma tabela amostrada).

## Fluxo principal

1. `pg_cron` dispara a checagem a cada **15 minutos** — ✅ **Resolvido
   (2026-07-22)**, decisão do usuário. Mesmo intervalo já usado pelo
   heartbeat de `bw-sync` (`bw-sync-heartbeat`, `CLAUDE.md` "Scheduled
   cadence") — reaproveita a mesma cadência de infraestrutura já validada
   em produção para um job recorrente sobre este schema, em vez de
   introduzir um segundo intervalo (30min) só para este motor. Como as
   regras deste motor são 100% SQL sobre agregados já sincronizados (sem
   chamada à Brandwatch — ver "Objetivo" acima), 15min não compete pelo
   orçamento de rate limit de `bw-sync`; o único custo é execução de
   queries Postgres, barato na escala do MVP. Revisitar se um teste de
   carga real (Sprint 3, quando este módulo for implementado) mostrar que
   15min é caro demais para o volume de organizações ativas — não uma
   decisão travada para sempre, só a que resolve a pendência registrada em
   `_pending.md` #4 com o dado disponível hoje.
2. Para cada organização ativa, o sistema calcula as janelas de comparação definidas abaixo,
   lendo dos agregados oficiais da Brandwatch já sincronizados por `foundation`.
3. Para cada janela, aplica as regras do MVP (variação %, volume mínimo, diferença absoluta,
   z-score).
4. Toda combinação `organization_id + scope_type + scope_id + event_type + window` que dispara
   uma regra é inserida em `radar_staging_events`.

## Escopo do evento (`scope_type`/`scope_id`)

> ⚠️ Nomeado `scope_type`/`scope_id` (não `entity_type`/`entity_id`) para não colidir com o termo
> de domínio reservado **Entity** (`_glossary.md` — pessoa/veículo de imprensa/partido/
> instituição, tabela `entities`). O que este motor detecta nunca é uma mudança "numa Entity" —
> é uma mudança num recorte de mentions (a Query inteira, uma Narrativa, uma plataforma).

| `scope_type`  | `scope_id` referencia         | Uso típico                                  |
|-----------------|----------------------------------|------------------------------------------------|
| `query`         | `bw_queries.id`                  | picos/quedas de volume ou sentimento da Query inteira |
| `narrative`     | `narratives.id`                  | picos/quedas por Narrativa (a maioria dos eventos) |
| `platform`      | `bw_query_metrics_daily_by_platform.page_type` (texto, não FK) | mudança concentrada numa plataforma específica |

## Janelas de comparação (MVP)

| Janela                          | Comparação                                  |
|-----------------------------------|-----------------------------------------------|
| Últimas 3h                        | vs. 3h imediatamente anteriores               |
| Últimas 24h                        | vs. 24h imediatamente anteriores              |
| Hoje                                | vs. mesmo dia da semana passada               |
| Hora atual                          | vs. média das últimas 4 semanas na mesma hora |
| Últimos 3 dias                      | vs. 3 dias imediatamente anteriores (também usada pela regra de Momentum, ver abaixo) |

> ✅ **Resolvido (2026-07-13)** — as janelas de "hora atual"/"últimas 3h" exigem grão horário,
> mais fino que o diário oficial. Pedido do usuário: "verificar se podemos corrigir a integração
> com a brandwatch para trazer essas informações no grão [horário]" — confirmado que sim:
> `foundation` ganhou `bw_query_metrics_hourly` (ver `foundation/data-model.md`), via
> `data/volume/sentiment/hours` + `data/netSentiment/{categories,queries}/hours` (mesma família
> de dimensão de chart já usada pra `days`/`weeks`/`months`, agora também `hours` — confirmado em
> `chart-dimensions-and-aggregates`). Janela **móvel de 30 dias** (não histórico completo) —
> cobre tanto "Últimas 3h" (últimas linhas) quanto "Hora atual vs. média das últimas 4 semanas"
> (`avg(...) group by extract(hour from metric_hour)` sobre os 30 dias retidos, sem precisar da
> dimensão cíclica `hourOfDay` da Brandwatch numa chamada separada). `bw_query_metrics_daily`
> continua sendo a fonte pras janelas de grão diário/semanal (Hoje, Últimos 3 dias) — sem mudança
> aí.

## Regras de negócio

- Todas as regras são funções SQL puras: variação percentual, volume mínimo (para evitar
  eventos estatisticamente "grandes" mas irrelevantes em volume absoluto), diferença absoluta,
  e z-score ≥ 2 (atenção) ou ≥ 3 (relevante) — calculadas sobre as séries já agregadas (ver
  "Dados envolvidos"), nunca sobre uma contagem própria de `mentions`.
- As regras de sentimento (`negative_sentiment_increase`, `negative_sentiment_spike`) usam os
  campos `sentiment_positive/neutral/negative` de `bw_query_metrics_daily`/`narrative_metrics`
  (campo **sentiment** padrão da Brandwatch) — **nunca** o classificador de **emotion** (coluna
  `mentions.emotion`), que só cobre inglês e produz sinal vazio para conteúdo PT-BR.
- ✅ **Regra `momentum_spike` (2026-08-07)** — só `scope_type = 'narrative'`, janela `3d`. Reaproveita
  a mesma fórmula/pesos de Momentum já em produção (`aggregated-metrics/sql-aggregation.md`) sobre
  uma janela fixa de 3 dias — não uma segunda fórmula divergente. Dispara quando o `momentum_score`
  calculado cruza a mesma faixa "Explosivo" (≥80) já definida naquele score. `comparison_value`
  grava o próprio limiar configurado (`event_radar_config().momentum_spike_threshold`) — não há um
  "valor anterior" natural de comparação aqui, diferente das regras de volume.
- Nenhuma chamada de IA acontece nesta etapa, em nenhuma circunstância.
- A saída vai para `radar_staging_events` — **não** grava direto em `feed_events`. A gravação
  final só acontece depois de dedup (1.2), severidade (1.3) e do agent (1.4).

## Dados envolvidos

- **Lê**: `bw_query_metrics_daily`/`weekly`/`monthly` (janelas de grão diário/semanal),
  `bw_query_metrics_hourly` (janelas "Últimas 3h"/"Hora atual", ver acima),
  `bw_query_metrics_daily_by_platform` (por plataforma), `narrative_metrics` (agregado já pronto
  por Narrativa, incl. `engagement_total`/`unique_authors`/`reach_estimated` para a regra
  `momentum_spike`) — todos agregados oficiais da Brandwatch, já sincronizados por
  `foundation`/`sync-brandwatch` (ver `foundation/data-model.md`). **Nunca**
  `SELECT`/`COUNT`/`SUM` direto sobre `mentions` para compor uma janela — se uma janela precisar
  de um grão que os agregados oficiais não cobrem, a decisão é registrar isso como gap explícito
  (ver histórico resolvido acima), não contornar com agregação local.
- **Escreve**: `radar_staging_events` (INSERT) — colunas mínimas: `organization_id`,
  `scope_type`, `scope_id`, `event_type`, `window`, `metric_value`, `comparison_value`,
  `delta_pct`, `z_score`, `detected_at`.

## Dependências técnicas

- `pg_cron` configurado no projeto Supabase (já usado por `refresh_narrative_metrics()` e
  `bw-sync`, ver `CLAUDE.md`).
- Índices já existentes em `bw_query_metrics_daily`/`weekly`/`monthly`/`hourly`/`_by_platform`
  (chave única por `query_id`/`category_id`/grão de tempo, ver `foundation/data-model.md`) — este
  motor não precisa de índice novo em `mentions`.

## Referências relacionadas

- [overview.md](overview.md)
- [data-model.md](data-model.md) — schema completo de `radar_staging_events`
- [deduplication-grouping.md](deduplication-grouping.md)
- [../foundation/data-model.md](../foundation/data-model.md)
