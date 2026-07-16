---
tipo: feature-spec
módulo: event-radar
funcionalidade: detection-engine
status: implementado
atualizado: 2026-07-16
---

# Motor de Detecção (100% SQL, sem IA)

> ✅ **Foco ampliado além de volume/sentimento — assuntos emergentes +
> menções de destaque (2026-07-16)** — user request: "hoje o foco do radar
> está no volume... precisamos acrescentar o foco nas trends, nos
> principais assuntos não só os que estão categorizados, mas nos que
> possam estar fora das categorias também... capturar de tempos em tempos
> algumas menções que estão no top de engajamento (publicação, repost e
> comentário) e com maior impacto... considerar somente as últimas 72h."
> Confirmado: até esta sessão, o motor só olhava volume/sentimento (+
> Momentum, via `momentum_spike`) — nunca "o quê" está sendo falado nem
> menções individuais. 3 decisões confirmadas com o usuário antes de
> implementar (`AskUserQuestion`): (1) assuntos emergentes reusam
> `bw_query_topics` já sincronizado, sem chamada nova à Brandwatch — "as
> últimas 72h" vira um **gate de frescor** sobre o snapshot já
> sincronizado (`synced_at >= now() - 72h`), não uma nova janela de data
> pedida à Brandwatch; (2) menções de destaque viram **cards completos via
> IA** (mesmo pipeline de severidade + agent-orchestrator já usado por
> volume/sentimento/momentum), não uma lista passiva; (3) assuntos
> emergentes só no escopo Query inteira (não perguntado de novo pra
> menções, por consistência: mesma escolha aplicada lá também).
>
> Migration `20260809160000_event_radar_topics_and_notable_mentions.sql`:
> 2 `scope_type` novos — `topic` (`scope_id` = `<topic_type>:<label>`,
> fonte `bw_query_topics` com `category_id is null` — que já cobre
> **qualquer** assunto da Query inteira, categorizado numa Narrativa ou
> não, já que inclui todas as menções da Query, não só as categorizadas) e
> `mention` (`scope_id` = `mentions.resource_id`, top-N por engajamento —
> soma de reposts/comentários por plataforma a partir de
> `mentions.engagement` — + `mentions.impact`, últimas 72h, organização
> inteira). 2 `event_type` novos — `emerging_topic` (dispara quando
> `volume >= min_volume` e `trending >= topic_trending_threshold`, ambos
> novos campos de `event_radar_config()`) e `notable_mention` (top-N
> configurável, `notable_mentions_limit`, default 5). Nenhum dos dois viola
> a premissa "nunca somar/agregar `mentions` pra representar um total"
> (2026-07-11) — `notable_mention` seleciona **linhas individuais** já
> sincronizadas (mesmo uso já sancionado por `full_text_enrichment`, que já
> seleciona top-N mentions por `reach_estimate`), nunca soma/conta sobre a
> amostra. Novo `window` value `72h` (não é uma janela de "delta" como as
> demais — é o gate de frescor/lookback descrito acima). `feed_event_type`
> (enum) ganhou 2 valores dedicados (`emerging_topic`/`notable_mention`) —
> nenhum dos 5 valores já reservados (`narrative_detected`/`case_created`/
> `case_status_changed`/`note_published`/`new_entity_detected`) cobria isso
> sem overload semântico.
>
> ⚠️ **Achado real ao revisar a severidade existente, corrigido na mesma
> migration**: `event_radar_volume_severity`/`event_radar_sentiment_severity`
> (20260729000000) tinham o MESMO bug de "hoje incompleto vs. dia
> histórico fechado" já corrigido em `run_event_detection()` pela sessão
> anterior (ver blockquote logo abaixo) — só na PRÓPRIA fórmula de
> severidade (fallback usado sempre que não há z-score horário, ou seja,
> **sempre** para escopo `platform`, que nunca tem grão horário). Ficou
> sem correção na sessão anterior porque aquela correção só tocou as
> janelas de DETECÇÃO, não as de SEVERIDADE (funções à parte). Corrigido
> agora com a mesma janela de 3 dias completos — relevante porque os 2
> novos `scope_type` também caem sempre nesse mesmo fallback (sem grão
> horário). `event_radar_reach_engagement_severity` também ganhou branches
> dedicados pra `topic`/`mention` (volume do assunto / `reach_estimate` da
> menção, relativos ao maior valor entre pares frescos da organização) —
> sem isso, os 2 novos tipos sempre cairiam no `coalesce(..., 50)` neutro
> do fator de maior peso (15%) entre os que se aplicam a eles.
>
> Ver `severity.md`/`agent-orchestrator.md` pra o detalhe completo dos 2
> novos fatores/branches.

> ✅ **Bug real corrigido (2026-07-16)** — user report: cards do Radar de
> Eventos descrevendo, ex., "No Twitter, o volume despencou 80,7% em 3 dias
> ... queda de 79,6% em 3 dias e 98,9% na comparação semanal", quando o
> volume diário real do Twitter se mantém estável (50-55% das menções).
> Causa raiz confirmada por leitura de código: as janelas "Hoje vs. mesmo
> dia da semana passada" e "Últimos 3 dias" sempre incluíam o dia de HOJE
> (`current_date`, ainda em andamento, só parcialmente sincronizado) como
> fronteira do período "atual", comparado contra dias históricos já
> fechados por completo — um dia incompleto somado sempre parece menor que
> um dia inteiro, produzindo quedas artificiais. Mesmo bug, embutido em
> `event_radar_narrative_momentum()` (fonte de `momentum_spike`). As
> janelas "Últimas 3h"/"Últimas 24h" (baseadas em `now()` real, não em
> fronteira de calendário) e "Hora atual vs. média das últimas 4 semanas"
> (usa explicitamente "a última hora já fechada") nunca tiveram esse
> problema. Fix, migration
> `20260809150000_event_radar_windows_exclude_incomplete_today.sql`: toda
> janela de calendário passa a ancorar em "ontem" (`current_date - 1`, o
> último dia já fechado), nunca em `current_date`. "Hoje vs. mesmo dia da
> semana passada" foi **removida** como regra ativa (o `window` value
> `today_vs_last_week` continua aceito no CHECK constraint só para não
> invalidar linhas históricas já fechadas) e substituída por uma janela
> "Últimos 7 dias" (últimos 7 dias completos vs. 7 dias completos
> anteriores — "semanal = últimos 7 dias", pedido explícito do usuário, em
> vez de um snapshot de dia-da-semana que sempre incluía o dia em
> andamento). "Últimos 3 dias" passou a comparar 3 dias completos
> (`current_date-3..current_date-1`) vs. 3 dias completos anteriores
> (`current_date-6..current_date-4`), em vez de incluir hoje. Nova janela
> "Últimos 30 dias" ("mensal = últimos 30 dias") — gap real, não existia
> nenhuma janela mensal antes desta correção. Ver a tabela "Janelas de
> comparação" abaixo, já atualizada. Pedido do usuário incluía também
> confirmar "diário = últimas 24h" — já correto desde sempre para
> `query`/`narrative` (janela horária, baseada em `now()`); `platform`
> nunca teve uma janela diária real (só "3d"/"7d"/"30d", todas agora
> corrigidas) — não existe grão horário por plataforma
> (`bw_query_metrics_daily_by_platform` é só diário), gap honesto,
> documentado, não fechado nesta correção (fora do escopo do bug
> reportado).

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
| `topic`         | texto polimórfico `<topic_type>:<label>` (não FK — `bw_query_topics` não tem PK textual própria exposta) | ✅ (2026-07-16) assunto/termo emergente, categorizado ou não |
| `mention`       | `mentions.resource_id` (texto, não FK direta — `mentions` é particionada por `mention_date`) | ✅ (2026-07-16) uma menção individual de destaque (engajamento/impacto) |

## Janelas de comparação (MVP)

> ⚠️ **Nenhuma janela de calendário compara mais um dia em andamento
> (hoje) com um dia já fechado** — corrigido 2026-07-16, ver blockquote no
> topo do arquivo. Toda janela "de N dias" abaixo usa **dias completos**,
> ancorados em "ontem" (`current_date - 1`), nunca em `current_date`.

| Janela                          | Comparação                                  |
|-----------------------------------|-----------------------------------------------|
| Últimas 3h                        | vs. 3h imediatamente anteriores (baseada em `now()` real, não em calendário) |
| Últimas 24h ("diário")              | vs. 24h imediatamente anteriores (baseada em `now()` real, não em calendário) |
| Últimos 7 dias completos ("semanal") | vs. 7 dias completos imediatamente anteriores |
| Últimos 30 dias completos ("mensal") | vs. 30 dias completos imediatamente anteriores |
| Hora atual                          | vs. média das últimas 4 semanas na mesma hora |
| Últimos 3 dias completos            | vs. 3 dias completos imediatamente anteriores (também usada pela regra de Momentum, ver abaixo) |

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
- ✅ **Regra `emerging_topic` (2026-07-16)** — só `scope_type = 'topic'`, janela `72h`. Fonte:
  `bw_query_topics` com `category_id is null` (assunto da Query inteira — inclui qualquer assunto,
  categorizado numa Narrativa ou não), restrito a linhas com `synced_at` dentro das últimas 72h
  (gate de frescor sobre o snapshot já sincronizado, não uma nova janela pedida à Brandwatch — ver
  blockquote no topo do arquivo). Dispara quando `volume >= min_volume` (reaproveitado) e
  `trending >= event_radar_config().topic_trending_threshold`. `comparison_value` grava o próprio
  limiar, mesmo padrão de `momentum_spike` (o `trending` da Brandwatch já É o delta, não há um
  "valor anterior" a comparar).
- ✅ **Regra `notable_mention` (2026-07-16)** — só `scope_type = 'mention'`, janela `72h`. Fonte:
  `mentions` das últimas 72h da organização inteira (todas as Queries), ranqueadas por engajamento
  (soma de reposts/comentários por plataforma, `mentions.engagement`) + `mentions.impact`
  combinados — top `event_radar_config().notable_mentions_limit` (default 5). Seleção de linhas
  individuais já sincronizadas — nunca soma/conta sobre a amostra pra representar um total (mesmo
  uso já sancionado por `full_text_enrichment`, ver `foundation/sync-brandwatch.md`).
  `comparison_value` grava `0` (baseline — qualquer engajamento acima de zero já qualifica pra
  estar no top-N).
- Nenhuma chamada de IA acontece nesta etapa, em nenhuma circunstância.
- A saída vai para `radar_staging_events` — **não** grava direto em `feed_events`. A gravação
  final só acontece depois de dedup (1.2), severidade (1.3) e do agent (1.4).

## Dados envolvidos

- **Lê**: `bw_query_metrics_daily`/`weekly`/`monthly` (janelas de grão diário/semanal),
  `bw_query_metrics_hourly` (janelas "Últimas 3h"/"Hora atual", ver acima),
  `bw_query_metrics_daily_by_platform` (por plataforma), `narrative_metrics` (agregado já pronto
  por Narrativa, incl. `engagement_total`/`unique_authors`/`reach_estimated` para a regra
  `momentum_spike`), `bw_query_topics` (assunto emergente, ✅ 2026-07-16 — agregado já pronto pela
  Brandwatch, `volume`/`trending`, nunca recalculado localmente) — todos agregados oficiais da
  Brandwatch, já sincronizados por `foundation`/`sync-brandwatch` (ver `foundation/data-model.md`).
  **Nunca** `SELECT`/`COUNT`/`SUM` direto sobre `mentions` para **compor uma agregação/total** — se
  uma janela precisar de um grão que os agregados oficiais não cobrem, a decisão é registrar isso
  como gap explícito (ver histórico resolvido acima), não contornar com agregação local.
  **Exceção deliberada, ✅ 2026-07-16**: a regra `notable_mention` lê `mentions` diretamente, mas
  só para **selecionar linhas individuais** (top-N por engajamento/impacto) — nunca para somar/
  contar sobre a amostra, mesmo uso já sancionado por `full_text_enrichment`
  (`foundation/sync-brandwatch.md`).
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
