---
tipo: feature-spec
módulo: intelligence-center
funcionalidade: sentiment-analysis
status: implementado
atualizado: 2026-07-17
---

# Análise de Sentimento

> ✅ **Implementado (2026-07-17)**: "Sentimento por Narrativa" (barras
> empilhadas positivo/neutro/negativo, uma por Narrativa) fechado nesta
> data — `get_narrative_sentiment_breakdown` (breakdown `type = 'narrative'`),
> ver `aggregated-metrics/sql-aggregation.md`. Achado numa auditoria pedida
> pelo usuário sobre a origem dos dados de sentimento por
> plataforma/narrativa/autores/termos: o dado (`narrative_metrics.sentiment_*`)
> já existia desde sempre, mas nenhuma function/bloco do envelope o expunha
> como lista — `block-mapping-per-page.md` nunca marcou esse breakdown pra
> esta página, e o próprio código de `/sentiment` já documentava o gap
> inline. "Drivers de sentimento" também ganhou separação visual em 2
> caixas (Drivers positivos/negativos, `SentimentDriversPanel`), espelhando
> o mockup original — mesmo dado de `get_term_signals`, sem mudança de
> function. "Sentimento por plataforma"/"por pauta" e "Menções que mais
> influenciaram" **não mudaram** nesta rodada — o primeiro continua
> corretamente limitado a `net_sentiment` (score único, limitação real da
> API Brandwatch, ver "Regras de negócio" abaixo), o segundo continua sem
> bloco no envelope (`_pending.md` #19, ainda aberto).

> Cobre "Página 3 — Análise de Sentimento" / item "9. Visualizações
> recomendadas" do documento de estrutura do protótipo
> (`Comunicacao Inteligente`, `scratch/document.txt`). **Sem protótipo
> interativo correspondente** — o `.dc.html` só implementa Visão Geral e
> Narrativas; esta spec parte direto do texto de estrutura, mapeado contra
> `foundation/data-model.md`.

## Objetivo

Dar uma visão dedicada e mais profunda do sentimento do que o card
compacto do Executive Overview: distribuição geral, evolução, composição
por Narrativa, por plataforma, por pauta, por localização, e os principais
"drivers" (termos/temas associados a cada polaridade).

## Usuários afetados

Mesmo público das demais páginas deste módulo.

## Fluxo principal

1. Usuário acessa `/sentiment`, com os mesmos filtros globais de
   organização/período do header (ver `executive-overview.md`).
2. Tela carrega, cada widget de forma independente (um widget falhar não
   derruba os outros — mesmo padrão de `executive-overview.md`):
   - Distribuição geral (positivo/neutro/negativo do período).
   - Evolução temporal do sentimento (série diária/semanal/mensal conforme
     granularidade, mesma regra de `foundation/overview.md`).
   - Sentimento por Narrativa (barras horizontais empilhadas).
   - Drivers de sentimento (termos/temas mais associados a cada polaridade).
   - Menções que mais influenciaram o sentimento (lista).
3. Sentimento por pauta depende de `electoral-themes.md` (Pauta = Narrativa
   de topo) — sem gap adicional, ver `electoral-themes.md`. Sentimento por
   plataforma e por localização têm captura própria desde 2026-07-12 (ver
   "Regras de negócio" abaixo) — com uma limitação importante: é um **score
   líquido** (`net_sentiment`), não o split positivo/neutro/negativo usado
   no resto do produto.

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Nenhum dado sincronizado ainda para o período | `<EmptyState />` por widget, mesmo padrão de `executive-overview.md` |
| Narrativa sem `bw_category_id` | Não aparece em "Sentimento por Narrativa" (mesma regra de `narrative_metrics`) |
| Falha ao carregar um widget | `<ErrorMessage retry />` isolado |

## Interface (UI)

- **Distribuição geral**: donut ou barras (positivo/neutro/negativo) — de
  `bw_query_metrics_daily` somado no período (Query inteira,
  `category_id is null`) ou de um agregado equivalente
  weekly/monthly quando disponível (evita somar diários manualmente se o
  agregado semanal/mensal oficial já cobre o período pedido — mesmo
  raciocínio de `bw_query_metrics_weekly`/`monthly`, ver
  `foundation/data-model.md`).
- **Evolução temporal**: linha com `sentiment_positive`/`neutral`/`negative`
  de `bw_query_metrics_daily`, granularidade automática por período (regra
  já especificada em `foundation/overview.md`).
- **Sentimento por Narrativa**: barras horizontais empilhadas, uma por
  Narrativa, de `narrative_metrics.sentiment_positive/neutral/negative` via
  `get_narrative_sentiment_breakdown` (breakdown `type = 'narrative'`) — ✅
  implementado 2026-07-17, escopado a Narrativas-folha (Subcategorias
  ativas), mesma granularidade da aba Narrativas.
- **Drivers de sentimento**: termos/temas mais associados a cada polaridade
  — de `bw_query_topics` (`topic_type`, `label`,
  `sentiment_positive`/`neutral`/`negative`), ordenado por
  `sentiment_negative`/`sentiment_positive` desc conforme a lista
  ("positivo"/"negativo"). Já disponível, sem gap — `bw_query_topics` já
  carrega sentimento por tema. ✅ Apresentação em 2 caixas separadas
  ("Drivers positivos"/"Drivers negativos") implementada 2026-07-17
  (`SentimentDriversPanel`) — mesmo dado de `get_term_signals`, termos
  neutros não aparecem em nenhuma das duas caixas. `get_term_signals`
  mistura todo `topic_type` (`words`/`phrases`/`hashtags`/`entities`/
  `people`/`places`/`organisations`) num só ranking, sem filtrar
  especificamente por `phrases` — não é um gap (a spec nunca pediu só
  frases), mas fica registrado caso o produto queira restringir no futuro.
- **Menções que mais influenciaram o sentimento**: lista de mentions
  individuais (não agregado) ordenada por `reach_estimate`/`impact`, mesmo
  padrão de "Menções relevantes" em `narratives-exploration.md`.

## Regras de negócio

- **Sentimento por plataforma**: ✅ **Resolvido (2026-07-12, migration
  `20260712020000`)** — `bw_query_metrics_daily_by_platform.net_sentiment`,
  via `data/netSentiment/pageTypes/days` (aggregate de chart oficial,
  confirmado em `chart-dimensions-and-aggregates`). ⚠️ **Limitação a
  exibir com clareza na UI**: `netSentiment` devolve um **score único**
  (não separa positivo/neutro/negativo como o resto do produto) — não há
  combinação de 3 dimensões (`sentiment` + `pageTypes` + `days`)
  documentada na API. Mostrar como um indicador de "sentimento líquido por
  plataforma", visualmente distinto do gráfico de 3 barras usado em
  "Sentimento por Narrativa"/"Distribuição geral" — mesmo cuidado já
  aplicado a `emotion` (nunca com o mesmo peso visual de um dado com split
  completo).
- **Sentimento por pauta**: depende de `electoral-themes.md` (Pauta =
  Narrativa de topo) — mesmo dado de "Sentimento por Narrativa" acima
  (split completo, sem a limitação de `net_sentiment`), sem gap adicional.
- **Sentimento por localização**: ✅ **Resolvido (2026-07-12, mesma
  migration)** — `bw_query_demographics_daily.net_sentiment`, via
  `data/netSentiment/{countries,continents,cities,regions}/days`, só para
  os 4 `dimension_type` de localização. Mesma limitação de score único do
  item acima.

## Dados envolvidos

- **Lê**: `bw_query_metrics_daily` (Query inteira e por Narrativa),
  `bw_query_metrics_weekly`/`monthly`, `narrative_metrics`, `bw_query_topics`,
  `mentions` (só para a lista de menções influentes, via
  `narrative_matched_mentions()` quando filtrado por Narrativa, ou direto
  por `query_id` quando não filtrado).
- Nenhuma escrita.

## Permissões

Mesma tabela de `executive-overview.md`.

## Referências relacionadas

- [intelligence-center/overview.md](overview.md)
- [foundation/data-model.md](../foundation/data-model.md)
- [executive-overview.md](executive-overview.md)
