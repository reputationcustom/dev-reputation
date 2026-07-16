---
tipo: feature-spec
módulo: intelligence-center
funcionalidade: sentiment-analysis
status: implementado
atualizado: 2026-07-14
---

# Análise de Sentimento

> ✅ **Ordem dos widgets reorganizada (2026-07-14, mesmo dia)** — pedido
> do usuário: "subir o Drivers de sentimento para abaixo de Sentimento
> por pauta e Insights abaixo de Sentimento por Pauta." Reordenação pura
> de JSX, nenhuma mudança de dado/componente. Ordem atual da página:
> Distribuição geral/Mudança de sentimento → Evolução temporal → por
> narrativa/plataforma/pauta → **Drivers de sentimento** → **Insights** →
> Sentimento por estado → Menções que mais influenciaram o sentimento.

> ✅ **2 ajustes de layout + bug real de escopo em "Insights" corrigido
> (2026-07-14)**, pedidos do usuário: (1) mover a tabela "Sentimento por
> pauta" pra baixo de "Sentimento por plataforma" (empilhadas na mesma
> coluna direita, "Sentimento por narrativa" sozinha na esquerda); (2)
> "Insights de sentimento estão relacionado aos sentimentos? se não
> estiver corrija" — achado real: `get_active_highlights` nunca teve
> filtro por `event_type`, então "Insights" (e "Mudança de sentimento",
> que lê a mesma lista de highlights como contexto) sempre mostrou
> eventos de qualquer tipo (`volume_spike`/`volume_drop`/`momentum_spike`
> inclusos), não só os relacionados a sentimento. Corrigido com
> `get_active_highlights(..., p_event_types)` (migration `20260809100000`)
> + `SENTIMENT_HIGHLIGHT_EVENT_TYPES` — mesmo mecanismo já usado pra
> escopar `/themes` a Pautas (2026-08-09), ver
> `aggregated-metrics/ai-synthesis.md`/`sql-aggregation.md` e `CLAUDE.md`
> pro detalhamento completo. Também corrigido, mesma sessão: o mapa de
> "Sentimento por estado" nunca colorindo de verdade (bug de classe
> Tailwind construída em runtime, `sentimentFillFromScore()`) e o widget
> reorganizado com mapa à esquerda + tabela à direita.

> ✅ **4 ajustes (2026-07-25)**, pedidos do usuário na mesma sessão:
> 1. **Rótulos no gráfico "Sentimento por narrativa"**: a barra empilhada
>    por Narrativa (`NarrativeSentimentList`, `breakdown-panel.tsx`) não
>    tinha nenhum percentual visível, só a cor — agora mostra "pos X% neu
>    Y% neg Z%" abaixo de cada barra, mesmo texto já usado no
>    `NarrativeCard`.
> 2. **Nome de colunas nas tabelas "Sentimento por plataforma"/"por
>    pauta"/"por estado"**: as 3 usavam `ScoreList` (`breakdown-panel.tsx`),
>    uma lista sem `<thead>` — viraram uma `<table>` real com 3 colunas
>    (Plataforma/Pauta/Estado — o nome muda por tipo — Participação,
>    Sentimento), mesmo padrão de cabeçalho (`font-bold text-text-primary`)
>    de `NarrativesTable`/`XInsightsPanel`.
> 3. **Mapa pra "Sentimento por estado"**: novo `BrazilSentimentMap`
>    (`components/intelligence-center/charts/brazil-sentiment-map.tsx`) —
>    SVG dos 27 estados coloridos pela mesma escala de 7 faixas de
>    sentimento, rótulo (sigla UF) sobre cada estado, legenda de cores.
>    Complementa a tabela do item 2 acima, não a substitui.
> 4. **"Drivers positivos" não aparecia**: causa raiz real em
>    `get_term_signals` — um único corte de `limit 50` ordenado por
>    `trending` (crescimento) geral, antes da classificação por sentimento,
>    podia esvaziar o bucket "positive" inteiro se os termos que mais
>    cresceram no período fossem majoritariamente negativos/neutros (comum
>    em cobertura política). Corrigido: ranking agora é feito **dentro de
>    cada bucket de sentimento** (top 20 positive/neutral/negative cada),
>    não mais um corte único global — ver "Drivers de sentimento" abaixo.
>
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

> ✅ **"Mudança de sentimento" wired (2026-08-03)** — pedido do usuário, a
> partir do que via na UI: "Análise textual de mudança de sentimento ainda
> não implementada — depende de síntese narrativa (ai-synthesis, ver
> _pending.md)." Esse `EmptyState` datava de 2026-07-13 (import do
> protótipo), quando `ai-synthesis` genuinamente não tinha nenhuma camada
> implementada. Não era mais verdade desde 2026-08-02 (Camadas 0/1 de
> `aggregated-metrics/ai-synthesis.md` implementadas, `/sentiment` é uma
> das 3 páginas que hoje alcançam a Camada 1 de verdade — `highlights` **e**
> `narrative_text` juntos em `PAGE_BLOCKS`, `get-page-sentiment` já
> deployada) — só ninguém tinha voltado a esta página pra trocar o
> `EmptyState` pelo dado real. `narrative_text` já estava sendo lido nesta
> mesma página, só no widget genérico "Insights" no fim da página — movido
> (não duplicado) pro widget "Mudança de sentimento", posição exata do
> protótipo original ao lado de "Distribuição geral". Nenhuma mudança de
> backend — só o frontend deixou de esconder um dado que já existia.

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

- ✅ **Toggle "Perspectiva: Tendência/Volume" (2026-08-09, migration
  `20260809130000`)** — no `PageHeaderBar`, controla o ranking de
  "Drivers de sentimento"/"Tópicos positivos e negativos" (`term_signals`)
  — `trending` (crescimento, default) ou `volume` (menções absolutas).
  Ver `aggregated-metrics/sql-aggregation.md`, "Perspectiva de ranking
  Trending × Volume".
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
  `sentiment_positive`/`neutral`/`negative`), classificado em positive/
  neutral/negative comparando os 3 contadores. Já disponível, sem gap —
  `bw_query_topics` já carrega sentimento por tema. ✅ Apresentação em 2
  caixas separadas ("Drivers positivos"/"Drivers negativos") implementada
  2026-07-17 (`SentimentDriversPanel`) — mesmo dado de `get_term_signals`,
  termos neutros não aparecem em nenhuma das duas caixas. `get_term_signals`
  mistura todo `topic_type` (`words`/`phrases`/`hashtags`/`entities`/
  `people`/`places`/`organisations`) num só ranking, sem filtrar
  especificamente por `phrases` — não é um gap (a spec nunca pediu só
  frases), mas fica registrado caso o produto queira restringir no futuro.
  ✅ **Deixou de ser exclusividade desta página (2026-07-14)** — pedido do
  usuário: "em todas as páginas é importante existir os principais
  tópicos positivos e negativos". O mesmo widget desta página agora
  também renderiza em `overview`/`narratives`/`platforms`/`themes`/
  `narrative_detail` (ver `aggregated-metrics/block-mapping-per-page.md`)
  — nada mudou aqui, só deixou de ser a única página com esse widget.
  Para o mapeamento tópico↔Narrativa individual (não a visão agregada
  deste widget), ver `narratives-exploration.md` e
  `aggregated-metrics/sql-aggregation.md`, "Mapeamento tópico↔Narrativa
  por polaridade" (`NarrativeRow.positive_topics`/`negative_topics`,
  campo novo separado deste bloco `term_signals`).
  ✅ **Unificado num único frame (2026-07-14, mesma sessão)** — pedido do
  usuário: "no mesmo frame mudando apenas a cor (vermelho, verde ou
  neutro)". `PositiveDriversList`/`NegativeDriversList` (2 `WidgetCard`s
  separados, "Drivers positivos"/"Drivers negativos") foram substituídos
  por um único `TopicSentimentList` ("Drivers de sentimento") — mesmas
  pills, mesmas cores por sentimento (`bg-sentiment-*-bg`/
  `text-sentiment-*`), agora incluindo também o bucket `neutral` (antes
  descartado) na mesma lista.
  ✅ **Bug real corrigido (2026-07-25, migration `20260726030000`)**:
  usuário reportou "Drivers positivos não aparecem". Causa raiz —
  `get_term_signals` ordenava TODOS os termos (de qualquer sentimento) por
  `trending` desc e cortava em `limit 50` **antes** de qualquer filtro por
  sentimento rodar no frontend; se os termos que mais cresceram no período
  fossem majoritariamente negativos/neutros (plausível em cobertura
  política, onde notícia negativa tende a viralizar mais rápido), o corte
  de 50 podia não sobrar nenhum termo "positive" — não porque não
  existissem termos positivos, mas porque não estavam entre os 50 que mais
  cresceram. Corrigido: o ranking agora usa `row_number() over (partition
  by sentiment_associated order by growth_pct desc)`, mantendo os top 20
  de **cada** bucket (positive/neutral/negative) em vez de um corte único
  global — "Drivers positivos" deixa de competir por espaço com termos de
  outro sentimento que cresceram mais rápido no mesmo período.
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
- **Sentimento por localização**: ✅ **Dado capturado (2026-07-12, mesma
  migration)** — `bw_query_demographics_daily.net_sentiment`, via
  `data/netSentiment/{countries,continents,cities,regions}/days`, só para
  os 4 `dimension_type` de localização. Mesma limitação de score único do
  item acima. ✅ **Bloco exposto como "Sentimento por estado" (2026-07-25,
  pedido do usuário: "breakdown por estado brasileiro")** —
  `get_region_breakdown` (`sql-aggregation.md`) lê `dimension_type =
  'region'` (a divisão administrativa por estado, dentro da hierarquia
  geográfica da Brandwatch), não mais `'country'` (decisão de escopo
  anterior, de baixo valor pra uma plataforma 100% de campanhas
  brasileiras). ⚠️ Mapeamento exato de `regions` → UF brasileira nunca
  confirmado contra um payload real, ver `foundation/data-model.md`.
  ✅ **Mapa adicionado (2026-07-25)**, pedido do usuário: "Sentimento por
  estado pode ser representado em um mapa com rótulos e cores." Novo
  `BrazilSentimentMap` (`components/intelligence-center/charts/
  brazil-sentiment-map.tsx`) — SVG com os 27 estados (geometria
  simplificada, dataset público `codeforgermany/click_that_hood`,
  reprojetada num viewBox fixo 640x640), cada estado colorido pela mesma
  escala de 7 faixas de `net_sentiment` já usada em `SENTIMENT_META`
  (`score-badges.tsx`), sigla UF como rótulo sobre cada estado (com um
  fundo semi-transparente atrás do texto pra legibilidade em qualquer cor
  de fundo), legenda de cores abaixo. Como o texto exato que a Brandwatch
  devolve por estado nunca foi confirmado (ressalva acima), o componente
  casa o `label` recebido por nome completo, sigla, ou substring
  (`findState()`) — qualquer item que não case com nenhum dos 27 estados é
  listado por extenso abaixo do mapa em vez de descartado silenciosamente.
  O mapa complementa a tabela (item acima, com nome de colunas) — a leitura
  geográfica de relance não substitui o número exato por estado.

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
