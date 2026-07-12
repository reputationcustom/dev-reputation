---
tipo: feature-spec
módulo: event-radar
funcionalidade: detection-engine
status: rascunho
atualizado: 2026-07-12
---

# Motor de Detecção (100% SQL, sem IA)

## Objetivo

Calcular, de forma puramente estatística, quando o comportamento das menções de uma
organização mudou o suficiente para virar um evento candidato — sem nenhuma chamada de IA
nesta etapa, e sem nenhuma agregação local sobre `mentions` (ver "Dados envolvidos" abaixo —
mesma premissa de `_index.md`/`CLAUDE.md`, já fixada depois de um bug real de produção com SOV
calculado por soma local sobre uma tabela amostrada).

## Fluxo principal

1. `pg_cron` dispara a checagem em intervalos regulares (ex: a cada 15-30min — definir junto do
   time de infra conforme volume).
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
| Últimos 3 dias                      | vs. 3 dias imediatamente anteriores           |

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
- Nenhuma chamada de IA acontece nesta etapa, em nenhuma circunstância.
- A saída vai para `radar_staging_events` — **não** grava direto em `feed_events`. A gravação
  final só acontece depois de dedup (1.2), severidade (1.3) e do agent (1.4).

## Dados envolvidos

- **Lê**: `bw_query_metrics_daily`/`weekly`/`monthly` (janelas de grão diário/semanal),
  `bw_query_metrics_hourly` (janelas "Últimas 3h"/"Hora atual", ver acima),
  `bw_query_metrics_daily_by_platform` (por plataforma), `narrative_metrics` (agregado já pronto
  por Narrativa) — todos agregados oficiais da Brandwatch, já sincronizados por
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
- [deduplication-grouping.md](deduplication-grouping.md)
- [../foundation/data-model.md](../foundation/data-model.md)
