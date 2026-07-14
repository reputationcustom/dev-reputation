---
tipo: feature-spec
módulo: aggregated-metrics
funcionalidade: sql-aggregation
status: implementado
atualizado: 2026-08-02
---

# Camada SQL de Agregação

> ✅ **Implementado (migration `20260714000000`, evoluído em várias sessões
> desde então — última alteração de schema `20260722010000`)**: 9 das 10
> functions da tabela abaixo estão em produção. Só `get_active_highlights`
> continua deferida — ⚠️ **atualizado 2026-08-02**: o motivo original
> ("depende de `feed_events`/`event-radar`, ainda `rascunho`") não é mais
> verdade — `event-radar` está implementado (1.1-1.4/1.6, `feed_events`
> populada desde 2026-07-31) e o gate real (`fluxo-aggregated-metrics.md`,
> "Fase B") já está satisfeito. A function em si só ainda não foi escrita
> nesta sessão (`_pending.md` gap #8, reaberto sem bloqueio real). Este
> arquivo reflete o estado atual do schema; qualquer nota `⚠️`/`✅` abaixo
> já foi aplicada ao banco (quando citar uma migration).

## Objetivo

Cada bloco do envelope deve ser calculado por uma function SQL (Postgres, via Supabase RPC)
reutilizável entre páginas — nunca por agregação feita em JavaScript dentro da Edge Function, e
nunca por soma/contagem local sobre `mentions`. `foundation`/`sync-brandwatch` já sincroniza os
agregados oficiais e não amostrados da Brandwatch (`bw_query_metrics_daily`/`weekly`/`monthly`,
`bw_query_metrics_daily_by_platform`, `bw_query_topics`, `bw_query_top_authors`,
`narrative_metrics` — ver `foundation/data-model.md`) — este módulo lê deles, não recalcula.

## Regra fundamental

> ⚠️ Nenhuma function deste módulo deve fazer `SELECT ... FROM mentions` e agregar em memória ou
> em SQL para representar um total/percentual/série. Essa é a mesma premissa já fixada em
> `_index.md`/`CLAUDE.md` ("nunca calcular localmente sobre mentions amostrada") depois de um bug
> de produção real (SOV calculado errado por agregação local) — vale integralmente para este
> módulo. A única leitura direta de `mentions` permitida é por-linha, nunca agregada: a lista de
> "conteúdos de destaque"/"menções relevantes" (mentions individuais, já com esse padrão em
> `intelligence-center/narratives-exploration.md`) e o grafo de disseminação simplificado
> (`get_dissemination_graph` abaixo — relação `reply_to`/`retweet_of`/`insights_mentioned` por
> mention, não uma soma).

## Functions a implementar

O Claude Code deve criar uma function por tipo de bloco, com assinatura consistente
`(organization_id uuid, period_start date, period_end date, filters jsonb)`, exceto onde
observado — **sem `query_id`** (revertido 2026-07-13, ver nota abaixo).

> ⚠️ **Uma organização pode ter 1+ Queries** (`bw_queries.project_id → bw_projects.organization_id`,
> um Project por organização com N Queries dentro — ex: N candidatos ou N canais acompanhados
> pela mesma organização), **mas isso nunca é exposto ao client** — pedido explícito do usuário
> (2026-07-13): "o seletor de organização é independente de Query... as Queries devem ser
> transparentes para o usuário final". Cada function abaixo resolve `query_id` **internamente**
> a partir de `organization_id` (`select id from bw_queries where project_id in (select id from
> bw_projects where organization_id = p_organization_id)`) e combina o resultado:
> - Blocos agregados/numéricos (`metrics`, `breakdowns`, `trends`): **soma** entre as Queries da
>   organização (`total_mentions`, `sentiment_*` etc. — todos já são contagens, somar é correto).
> - `narratives` (`get_narratives_table`): **união** das Narrativas de todas as Queries da
>   organização numa lista só — mas o SOV de cada linha continua calculado contra o total da
>   **sua própria Query** (`narrative_metrics.query_id`), nunca contra o total combinado da
>   organização. É exatamente a distinção que evita reintroduzir o bug de SOV de 2026-07-11
>   (agrupar por organização inteira em vez de por Query) — a diferença agora é que o usuário
>   nunca escolhe a Query, só vê a lista combinada com cada SOV já correto.

| Function                              | Bloco que alimenta | Tabela(s) de origem real                              |
|-----------------------------------------|---------------------|-------------------------------------------------|
| `get_metrics_cards(...)`                | `metrics`           | `bw_query_metrics_daily`/`weekly`/`monthly` com `category_id is null` (Query inteira): `total_mentions`, `net_sentiment` (score -100..100, média ponderada por `total_mentions`), `reach_estimate`, `engagement_score`, `unique_authors`. ⚠️ O card "Sentimento geral" no frontend **não** renderiza este `net_sentiment` — ver nota abaixo da tabela |
| `get_sentiment_breakdown(...)`          | `breakdowns`        | `bw_query_metrics_daily`/`weekly`/`monthly` (campos `sentiment_positive/neutral/negative`) |
| `get_platform_breakdown(...)`           | `breakdowns`        | `bw_query_metrics_daily_by_platform` (`category_id is null` para o total; `net_sentiment` quando o breakdown for de sentimento por plataforma — ver limitação de score único em `intelligence-center/sentiment-analysis.md`) |
| `get_theme_breakdown(...)`              | `breakdowns`        | `narrative_metrics`/`narratives` filtrado a `bw_category_id` apontando para uma **Subcategory da Category raiz "Pautas"** (`pautas_root_category_id()`, ✅ corrigido 2026-07-21 — antes era "qualquer `bw_categories` raiz", ver `intelligence-center/electoral-themes.md`) |
| `get_narrative_sentiment_breakdown(...)` | `breakdowns` (type `'narrative'`) | ✅ **Adicionado 2026-07-17** — `narrative_metrics.sentiment_positive/neutral/negative`, filtrado a Narrativas-folha (`bw_categories.parent_id is not null`, `status = 'active'`). Diferente de `get_platform_breakdown`/`get_theme_breakdown` (que devolvem `net_sentiment`, um score único), esta function devolve o **split completo** (`positive`/`neutral`/`negative`, cada um já normalizado em % daquela Narrativa) — o dado já existia em `narrative_metrics` desde sempre, só faltava esta function/o bloco correspondente (gap real, achado numa auditoria pedida pelo usuário — "verifique como estão vindo os dados... sentimento por narrativa" — e fechado na mesma sessão, ver `_pending.md` #19 e `CLAUDE.md`) |
| `get_volume_trend(...)`                 | `trends`             | `bw_query_metrics_hourly`/`daily`/`weekly`/`monthly`, reaproveitando a regra de granularidade automática já especificada em `foundation/overview.md` ("Tabela interativa de Narrativas"/gráfico de volume) — não redefinir aqui. ✅ **Grão `hour` adicionado (2026-07-19)** — período de exatamente 1 dia (modo "Diário" do header) usa `bw_query_metrics_hourly`; `bucket_date` é `text`, não `date` (só o grão `hour` precisa de instante com hora, ver migration `20260719000000`) |
| `get_platform_volume_trend(...)`        | `trends` (só `platforms`) | ✅ **Adicionado 2026-07-25** (migration `20260725030000`, gap #10) — `bw_query_metrics_daily_by_platform`, um `group` por `page_type` (`series_by_group`). Sem agregado oficial semanal/mensal por plataforma na Brandwatch — reagrupa o diário localmente via `date_trunc` quando o período pedido > 31 dias (mesma regra de grão de `get_volume_trend`, sem grão `hour`) |
| `get_theme_sov_trend(...)`              | `trends` (só `themes`)    | ✅ **Adicionado 2026-07-25** (migration `20260725030000`, gap #10) — `narrative_metrics` (Pautas) + `bw_query_metrics_daily` (denominador, Query inteira), um `group` por título de Pauta. SOV por bucket = soma de menções da Pauta / soma de menções da Query inteira nos dias daquele bucket, mesma definição de `narratives_overview.sov_percent` — `p_filters` mantido na assinatura por consistência, não usado (SOV nunca é filtrado por Narrativa) |
| `get_region_breakdown(...)`             | `breakdowns` (type `'region'`) | ✅ **Adicionado 2026-07-25** (migration `20260725010000`, gap #9, decisão do usuário na época: "país + net_sentiment"), **repivotado no mesmo dia para estado brasileiro** (migration `20260725060000`, pedido do usuário: "Precisamos de um breakdown por estado brasileiro") — `bw_query_demographics_daily` (`dimension_type = 'region'`, já sincronizada por `foundation`/`bw-sync` desde `20260711070000`, nenhuma mudança em `bw-sync` foi necessária), top 30 estados por volume, `value` = `net_sentiment` médio ponderado, `pct` = participação de menções. País deixou de ser exposto por este bloco — pra uma plataforma 100% de campanhas brasileiras, quebra por país é quase sempre "Brasil: 100%" (baixo valor). ⚠️ **Duas ressalvas não confirmadas contra payload real**: (1) o mapeamento exato da dimensão de chart `regions` da Brandwatch para UF brasileira — mesma ressalva já registrada em `foundation/data-model.md` desde que essa dimensão foi implementada; (2) esta tabela **nunca teve `category_id`** — só cobre o escopo "Query inteira"; com `filters.narratives` ativo (ex: `narrative_detail`), devolve vazio de propósito, nunca o dado da Query inteira mascarado como se fosse de uma Narrativa |
| `get_volume_delta(...)`                 | nenhum (helper interno) | ✅ **Adicionado 2026-07-25** (migration `20260725020000`, gap #27) — não é um bloco do envelope, só usado por `fetchNarrativeText` (`service-layer-aggregation.md`) pra montar a Camada 0 de `ai-synthesis.md`. `total_mentions` do período atual vs. anterior, escopado por `filters.narratives` (mesmo padrão de `get_sentiment_breakdown`) |
| `get_narratives_table(...)`             | `narratives`         | `reporting.narratives_overview`/`public.narratives_overview` (view já existente, ver `foundation/data-model.md`) pro dado bruto por dia (`sov_percent`, `net_sentiment`/`sentiment_bucket`, `total_mentions`, `reach_estimated`, `engagement_total`, `unique_authors`) — **mas** os 3 scores derivados (`momentum_score` período-dependente, `trend_score` sempre 14 dias fixos, `risk_score`) são calculados **nesta function**, não na view (a view não recebe `period_start`/`period_end`) — ver seção "Scores de Narrativa" abaixo |
| `get_authors_ranking(...)`              | `authors`            | `bw_query_top_authors`/`bw_query_top_tweeters` (quando o escopo for X) — nativos da Brandwatch, não amostrados. `entity_id` e a classificação por partido/espectro (`entity_cargo`/`entity_partido`/`entity_ideologia`/`entity_influence_level`/`entity_tags`) vêm de um `LEFT JOIN entity_accounts`/`entities`/`entity_tags` (por `lower(trim(username)) = lower(trim(author))`, nunca uma FK — ver [entities/author-linking.md](../entities/author-linking.md)) — sempre enriquecimento aditivo, nunca pré-requisito do ranking, `null`/`[]` pra qualquer autor sem Entity vinculada. ✅ **Implementado (2026-08-01, migration `20260801010000`)** — também ganhou `mentions` (soma de menções por autor, já calculada internamente pra ordenar o ranking, agora também exposta ao client). ✅ **Ganhou `sentiment_positive`/`neutral`/`negative` (2026-07-17)** — `LEFT JOIN` agregado sobre `bw_query_author_topics` (soma os 3 contadores entre todos os temas do autor na semana mais recente sincronizada para aquele autor), não sobre `bw_query_top_authors.sentiment_*`. ⚠️ **Achado na mesma auditoria**: `bw_query_top_authors.sentiment_positive/neutral/negative` (e o mesmo em `bw_query_top_tweeters`) é escrito por `bw-sync` desde a criação da tabela lendo `d.sentiment` da resposta de `data/volume/topauthors/queries`, mas — diferente de todo campo vizinho na mesma tabela (`tweets`/`retweets`/`account_type`/`country_code`, todos com nota "confirmado contra developers.brandwatch.com/docs/top-tweeters") — esse mapeamento **nunca foi confirmado** contra a documentação real do endpoint, que não cita um objeto `sentiment` no payload. Risco real de ser sempre `0/0/0` em produção sem nenhum erro (fallback `?? 0`). Decisão do usuário (2026-07-17): documentar o achado e usar `bw_query_author_topics` (fonte já confirmada, mesmo padrão do `impressions` por autor) em vez de gastar uma chamada nova pra confirmar/substituir o campo agora — ver `foundation/data-model.md`, "bw_query_top_authors". Limitação herdada: só os top 10 autores por volume da Query inteira têm `bw_query_author_topics` — os demais autores do ranking vêm com os 3 campos `null` (nunca `0/0/0`, que seria "sentimento neutro" inventado). ✅ **Ganhou `p_scope`/`narrative_labels` (2026-07-21)** — ver nota dedicada abaixo, "Regras de negócio" |
| `get_dissemination_graph(narrative_id)` | `graph`              | `mentions` (`reply_to`/`retweet_of`/`insights_mentioned`), restrito às mentions retornadas por `narrative_matched_mentions(narrative_id)` — reusa a função canônica já definida em `foundation/data-model.md`, mesma abordagem já decidida em `intelligence-center/narratives-exploration.md` ("grafo de disseminação simplificado"), não uma tabela `grafo_arestas` nova |
| `get_term_signals(...)`                 | `term_signals`       | `bw_query_topics` (`label`, `sentiment_positive/neutral/negative`, `trending`) — já carrega tema/sentimento/tendência, não precisa extrair termo de `mentions` |
| `get_x_insights(...)`                   | `x_insights` (só `platforms`) | ✅ **Adicionado 2026-07-18** — `bw_query_x_insights` (`insight_type`: `hashtag`/`emoticon`/`url`/`mentioned_author`), até 10 itens por tipo, ordenados por `volume` desc, da semana mais recente sincronizada por tipo. Fecha um gap real: o dado já era capturado desde `foundation` (2026-07-11), mas nenhuma function/bloco o expunha — era só uma "oportunidade futura" registrada em `intelligence-center/platform-analysis.md` (2026-07-13), nunca implementada até esta auditoria. É o dado por trás de "Top Hashtags"/"Most Mentioned X Posters"/"Top Stories"/"Top Emojis" (dashboard nativo "X Themes" da Brandwatch) |
| `get_active_highlights(...)`            | `highlights`         | `feed_events` (populada pelo módulo `event-radar`, tipo/tag `"radar"`) — **leitura pura, sem cálculo**: filtra por `organization_id`, `period`, escopo da página (narrativa/pauta/plataforma quando aplicável) e ordena por `severity_score` desc, respeitando o cap diário já aplicado na inserção pelo radar |

> ✅ **Card de KPI "Sentimento geral" usa `get_sentiment_breakdown`, não o
> `net_sentiment` de `get_metrics_cards` (2026-07-13)** —
> `intelligence-center/executive-overview.md` sempre pediu, pros "Cards de
> topo", uma "distribuição positivo/neutro/negativo compacta" pro
> Sentimento geral, não um score único; a implementação original desviou
> disso (achado direto pelo usuário na tela: um score isolado como "-1",
> sem a escala -100..100 por perto, não comunica nada). Corrigido no
> frontend, sem function SQL nova: a página busca `breakdowns` (`type =
> 'sentiment'`) de qualquer forma para o widget "Sentimento geral" que já
> existia abaixo da grade de KPIs — o card de KPI agora reaproveita esse
> mesmo resultado (`SentimentMetricCard`,
> `components/intelligence-center/metric-card.tsx`) em vez de ler
> `envelope.metrics` para essa posição específica. `get_metrics_cards`
> continua devolvendo `net_sentiment` sem mudança nenhuma — o score bruto
> segue disponível no bloco `metrics` para quem precisar dele (ex: uma
> eventual página de relatórios), só não é mais o que este card
> específico renderiza. Ver `intelligence-center/executive-overview.md`
> e `CLAUDE.md` para o detalhamento completo.

> ✅ **`get_metrics_cards` distingue "ainda sincronizando" de "zero
> confirmado" (2026-07-21)** — pedido do usuário: "Valores nulos em
> Autores únicos, Alcance estimado e engajamento total quando o período
> Diário é selecionado." Causa raiz: `reach_estimate`/`engagement_score`/
> `unique_authors` em `bw_query_metrics_daily` são colunas nullable sem
> default, preenchidas por chamadas que rodam depois do loop de
> sentimento e das 2 chamadas de `netSentiment` (reordenadas 2026-07-20,
> ver `foundation` "Sentimento por narrativa/autores") dentro da fase
> `daily_metrics` de `bw-sync` — chamadas que podem não ter rodado ainda
> pra HOJE (orçamento de 25 chamadas esgotado antes de chegar nelas, ou
> invocação ainda não rodou desde meia-noite). `get_metrics_cards` fazia
> `coalesce(sum(...), 0)` incondicional pras 3 métricas — inofensivo num
> período de 7/30 dias (a soma dos outros dias mascara um dia pendente),
> mas pro período "Diário" (1 dia = hoje, único dia no período) isso
> transformava "ainda não sincronizado" num falso 0 (e um falso "-100% vs.
> período anterior"). Corrigido (migration `20260721000000`):
> `current_value`/`previous_value` dessas 3 métricas agora retornam `null`
> só quando o dia já tem menções (`total_mentions > 0`) mas a métrica em
> si ainda está sem nenhum valor sincronizado nesse intervalo; continuam
> em `0` quando realmente não houve menção nenhuma (0 é o valor correto
> nesse caso, não um placeholder). `MetricCard.value`
> (`@reputation/shared-types`) passou de `number` pra `number | null` —
> `fetchMetrics` (`aggregated-metrics-service.ts` + as 6 cópias nas Edge
> Functions, Princípio técnico 5) não coalesce mais pra `0` na borda do
> envelope. Frontend (`metric-card.tsx`) renderiza "—"/"Ainda
> sincronizando…" pra `value === null`, em vez do "0"/queda de -100%
> enganosos de antes.

> ✅ **"Sentimentos de narrativas estão predominante neutros" —
> reauditado, nenhum bug novo encontrado (2026-07-21)** — mesmo pedido do
> usuário repetido (verbatim igual ao de 2026-07-20). Reconfirmado nesta
> sessão, função por função, que a causa raiz já identificada e corrigida
> em `20260720000000` (fórmula de fallback enviesada pra 'neutral' +
> chamadas de `netSentiment` esgotando o orçamento antes de rodar) segue
> corretamente implementada: `public.narratives_overview.sentiment_bucket`
> usa a base não-diluída (`positivo/(positivo+negativo)`, mesma definição
> de `net_sentiment`) e `runDailyMetricsStep` já roda as 2 chamadas de
> `netSentiment` logo após o loop de sentimento, antes de reach/
> engajamento/autores/impressões. `get_narratives_table.sentiment_label`
> repassa `narratives_overview.sentiment_bucket` sem nenhum cálculo
> paralelo divergente; `get_narrative_sentiment_breakdown` soma
> proporções reais (não usa threshold nenhum, não pode sofrer o mesmo viés
> de diluição). Nenhuma causa adicional encontrada nesta revisão — se o
> sintoma persistir depois deste deploy, o próximo passo exige acesso a
> log de produção real de `bw-sync` (não disponível nesta sessão, mesma
> limitação já registrada em `CLAUDE.md`) pra confirmar se
> `net_sentiment`/`sentiment_positive`/`negative` estão de fato chegando
> em `bw_query_metrics_daily` pras Narrativas afetadas.

> ✅ **`get_x_insights` — nomes de campo reconfirmados ao vivo (2026-07-18)**:
> `volume`/`tweets`/`retweets`/`impressions`/`reachEstimate`/`sentiment` são
> os nomes exatos usados pelos 4 endpoints de X Insights
> (`developers.brandwatch.com/docs/twitter-insights`), verificado
> diretamente contra a doc nesta sessão (não só herdado da confirmação de
> 2026-07-11/13 em `foundation/data-model.md`). Os rótulos "Posts"/
> "Reposts"/"All Posts"/"Impressions" que aparecem no dashboard nativo da
> Brandwatch ("X Themes") são só apresentação da própria Brandwatch em cima
> desses mesmos 4 campos — `tweets` = Posts, `retweets` = Reposts, `volume`
> = All Posts (soma de tweets+retweets), `impressions` = Impressions.
> Conferido também aritmeticamente contra um export real do usuário (ex:
> `#flaviobolsonaropresidente2026`: Posts 10 + Reposts 402 ≈ All Posts 413).

## Scores de Narrativa: Sentimento, Momentum, Tendência e Risco

> ✅ Especificado 2026-07-13, a pedido do usuário, substituindo os 2
> ⚠️ DECISÃO PENDENTE que existiam pra Sentimento/Momentum em
> `intelligence-center/executive-overview.md` e introduzindo 2 indicadores
> novos (Velocidade, separada de Momentum; Risco como score, não só
> `narratives.risk_level`). Todos os 4 scores são calculados **uma vez, aqui**
> (dentro de `get_narratives_table`) e reaproveitados por toda página que
> mostra a tabela de Narrativas (`executive-overview.md`,
> `narratives-exploration.md`, `electoral-themes.md`, todas via este mesmo
> envelope) — nenhuma delas recalcula nada, só renderiza o que o bloco
> `narratives` do envelope já traz prontinho (banda + cor + valor).
>
> ✅ **Velocidade → Tendência (2026-07-22, migration `20260722010000`)** —
> pedido do usuário: "Vamos retirar a opção de velocidade em narrativas e
> substituir por tendência, em que, baseado nos valores é calculada uma
> tendência estatística da narrativa, se ela tende a diminuir ou a
> aumentar. Dessa maneira os indicadores se mantém como risk_score e
> momentum." Momentum e Risco continuam existindo como indicadores, sem
> mudança de forma — só o quarto score (antes "Velocidade") muda de nome e
> de método, ver "Tendência" abaixo. Todo texto desta seção foi atualizado
> para refletir o estado atual; a subseção antiga "Velocidade" fica
> preservada logo abaixo, marcada como histórico, para quem precisar
> entender a mudança.

### Sentimento (derivado localmente das proporções, não repassado direto de um score externo)

> ✅ **Correção #1 (2026-07-25, migration `20260725000000`)**: o parágrafo
> original ("repassa o valor do dia mais recente") era a causa raiz de um
> bug real reportado pelo usuário via screenshot — o card de Narrativa
> (borda esquerda + `sentiment_label`) e a coluna "Sentimento" da tabela
> liam `net_sentiment`/`sentiment_label` de um único dia (o mais recente
> dentro do período), enquanto a mesma linha/card também exibe
> `sentiment_positive_pct`/`neutral_pct`/`negative_pct` **somados sobre
> todo o período** — duas janelas de tempo diferentes na mesma linha,
> podendo discordar. Corrigido: `net_sentiment` passou a agregar sobre a
> mesma janela de `period_agg`.
>
> ✅ **Correção #2 (2026-07-25, migration `20260725060000`, mesmo dia)**:
> mesmo depois da correção #1, o usuário reportou de novo via screenshot
> (card "Economia": pos 17,1% / neu 40,3% / neg 42,5% — negativo é
> predominante — com borda/rótulo "Neutro"). Causa raiz **diferente**
> desta vez: a correção #1 ainda preferia a média ponderada do
> `net_sentiment` **oficial** da Brandwatch
> (`narrative_metrics.net_sentiment`, endpoint `data/netSentiment/
> categories/days`) quando esse score estava sincronizado, caindo pro
> cálculo local só como fallback. Só que `net_sentiment` vem de uma
> chamada de API **diferente e independente** de `data/volume/sentiment/
> days` (a origem de `sentiment_positive`/`neutral`/`negative`, os mesmos
> 3 números da barra do card) — dois agregados oficiais da Brandwatch,
> cada um calculado pelo motor deles, sem garantia de reconciliar entre
> si. É exatamente o que aconteceu: `net_sentiment` oficial caiu na faixa
> neutra enquanto a proporção real entre positivo/neutro/negativo (a
> mesma que a barra do card mostra) tem negativo como maioria — o rótulo/
> borda contradiziam visualmente os próprios números exibidos ao lado no
> mesmo card. **Corrigido definitivamente**: `net_sentiment`/
> `sentiment_label` passam a vir **sempre** do cálculo local — nunca mais
> do `net_sentiment` oficial da Brandwatch, nem como média ponderada nem
> como preferência sobre o fallback. Isso não reabre a regra de "nunca
> calcular localmente sobre `mentions` amostrada" (Princípio técnico 2):
> `sentiment_positive`/`neutral`/`negative` em `narrative_metrics` **já
> são** um agregado oficial da Brandwatch (`data/volume/sentiment/days`),
> a fórmula só deriva um score a partir deles — a mesma lógica que já era
> usada como fallback desde `20260720000000`, agora promovida a única
> fonte. Por construção, o rótulo/borda nunca mais podem discordar da
> barra pos/neu/neg do mesmo card, já que vêm exatamente dos mesmos 3
> números. `risk_score`'s `sentiment_risk` herda a correção automaticamente
> (lê `sentiment_labeled.net_sentiment`, sem mudança própria).
>
> ✅ **Correção #3 (2026-07-14, migration `20260731050000`)**: a promessa
> de "por construção nunca mais discorda da barra" da Correção #2 ainda
> tinha um buraco real, achado via screenshot novo (cards "Direita"/
> "Esquerda": `neu` era o balde MAIOR — 44,2%/47,7% — mas o rótulo mostrava
> "Negativo -20"/"Negativo -29"). A fórmula `(positivo - negativo) /
> (positivo + negativo) * 100` em si estava correta e batendo com os
> números — só nunca checava se Neutro era o balde predominante antes de
> calcular o skew só entre as duas MINORIAS (positivo e negativo).
> Matematicamente: Direita `(22.3-33.5)/(22.3+33.5)*100 = -20.07`,
> Esquerda `(18.5-33.8)/(18.5+33.8)*100 = -29.25` — a fórmula funcionava
> exatamente como projetada, "projetada" é que nunca cobria esse caso.
> Diferente das Correções #1/#2 (janela de tempo divergente, depois duas
> fontes divergentes) — este é um terceiro problema, novo: o par certo de
> dados (`sentiment_positive_pct`/etc.) aplicado à pergunta errada
> ("quem vence entre positivo e negativo" em vez de "qual dos 3 baldes
> vence"). **Corrigido**: `sentiment_label` agora checa primeiro se Neutro
> é o balde predominante (`>=` positivo E `>=` negativo, com alguma menção
> neutra de fato) — se for, o rótulo é sempre `'neutral'` e `net_sentiment`
> reportado é `0` (evita um "Neutro -20" contraditório na UI). Só quando
> Neutro não é predominante o skew positivo/negativo volta a decidir o
> rótulo, nas mesmas 7 faixas de sempre. `risk_inputs.sentiment_risk`
> herda a correção automaticamente.
>
> ⚠️ **Fora de escopo desta correção**: `public.narratives_overview.
> sentiment_bucket`/`net_sentiment` (view usada só para `sov_percent`/
> `total_mentions` em `get_narratives_table`'s `latest_day`, e espelhada em
> `reporting.narratives_overview` para BI externo) continua preferindo o
> `net_sentiment` oficial com fallback local, snapshot por dia — mesma
> classe de risco teórica (duas fontes divergentes), mas nenhuma tela do
> produto lê `sentiment_bucket` desta view diretamente hoje (confirmado
> por busca no código), então não há sintoma visível pra corrigir aqui.
> Revisitar se um consumidor de BI reportar a mesma contradição.

Fonte: **sempre** o cálculo local sobre
`narrative_metrics.sentiment_positive/neutral/negative` somados no mesmo
`period_start`/`period_end` pedido — a mesma base de
`sentiment_positive_pct`/`neutral_pct`/`negative_pct` (`(positivo -
negativo) * 100 / (positivo + negativo)`, nunca dividido pelo total de
mentions). **Nunca** o `narrative_metrics.net_sentiment` oficial da
Brandwatch (ver correção #2 acima — endpoint diferente, sem garantia de
reconciliar com a barra pos/neu/neg do mesmo card). Banda (7 faixas) e cor
ficam em `intelligence-center/executive-overview.md`/`_design-tokens.md`
— este módulo não decide cor, só entrega o número.

### Função auxiliar `norm_growth` (usada por Momentum; mesma lógica de
### normalização reaplicada manualmente por Tendência, ver abaixo)

Normaliza uma taxa de crescimento (ilimitada) pra uma escala fixa de 0 a
100, centrada em 50 (crescimento zero = score 50):

```sql
create or replace function norm_growth(current_value numeric, previous_value numeric)
returns numeric
language sql
immutable
as $$
  select case
    when previous_value is null or previous_value = 0 then 50
    else greatest(0, least(100,
      50 + greatest(least((current_value - previous_value) / previous_value, 1), -1) * 50
    ))
  end
$$;
```

Ou seja: crescimento de +100% (dobrou) ou mais → 100; queda de -100%
(zerou) ou mais → 0; sem crescimento → 50; entre isso, linear. Sem
histórico anterior (`previous_value` nulo/zero) → 50 (neutro/moderado, não
um extremo — não há base pra dizer "cresceu" ou "caiu").

### Momentum (0-100) — força/relevância atual, composta por 4 fatores

"Quão forte e relevante a narrativa está agora" — cresce com volume,
engajamento, autores únicos e alcance, todos comparando o **período
selecionado** (`period_start`/`period_end`, os mesmos 7/14/30 dias da
tela) contra o período imediatamente anterior de igual duração:

```sql
momentum_score = round(
  0.40 * norm_growth(vol_current, vol_previous) +       -- soma de total_mentions no período
  0.25 * norm_growth(engagement_current, engagement_previous) +  -- soma de engagement_total
  0.20 * norm_growth(authors_current, authors_previous) +        -- média de unique_authors no período
  0.15 * norm_growth(reach_current, reach_previous)              -- soma de reach_estimated
)
```

Todos os 4 inputs vêm de `narrative_metrics` (já oficiais/não amostrados,
ver `foundation/data-model.md`) — nenhuma chamada nova à Brandwatch.

| Faixa | Situação |
|---|---|
| 0–19 | Muito baixo |
| 20–39 | Baixo |
| 40–59 | Moderado |
| 60–79 | Alto |
| 80–100 | Explosivo |

### Tendência (0-100 + rótulo/seta) — tendência estatística, distinta de Momentum

> ✅ **Substitui "Velocidade" (2026-07-22, migration `20260722010000`)** —
> pedido do usuário: "Vamos retirar a opção de velocidade em narrativas e
> substituir por tendência, em que, baseado nos valores é calculada uma
> tendência estatística da narrativa, se ela tende a diminuir ou a
> aumentar." Diferença de desenho, não só de nome: Velocidade comparava 2
> pontos fixos (soma das últimas 3h vs. as 3h imediatamente anteriores) —
> um snapshot curtíssimo, sensível a ruído pontual. Tendência usa uma
> regressão linear de verdade (agregado padrão SQL `regr_slope`) sobre a
> série diária de `narrative_metrics.total_mentions` dos últimos 14 dias —
> "baseado nos valores" no sentido literal do pedido (múltiplos pontos, não
> 2), classificada em 3 estados (não mais os 5 rótulos de Velocidade).

Como Momentum (mas por um motivo diferente — não é o período escolhido na
tela, é uma janela fixa maior o bastante pra sustentar uma regressão),
Tendência é **independente do filtro de período** — mede se a narrativa
tende a crescer ou encolher nas últimas ~2 semanas, não no período que o
usuário escolheu olhar:

```sql
-- regressão linear (total_mentions diário x dia) dos últimos 14 dias de
-- narrative_metrics; variação total estimada no período (slope * n)
-- normalizada pela própria média do período, clampada em ±100% —
-- mesma convenção de norm_growth (50 = estável), só que aplicada a um
-- coeficiente de regressão em vez de um par current/previous
trend_score = 50 + clamp((slope_per_day * n_points) / avg_mentions, -1, 1) * 50
```

Exige pelo menos 4 dias de histórico na Narrativa (`n_points >= 4`) — sem
isso, `trend_score`/`trend_label` ficam `null` ("sem histórico suficiente
para uma tendência estatística", não um valor inventado).

> ✅ **Gap técnico #31 de `_pending.md` resolvido (2026-07-25, migration
> `20260726010000`)**: `get_narratives_table` ganhou o parâmetro opcional
> `p_reference_at timestamptz default now()`, substituindo a referência
> interna a `now()` no cálculo de Tendência — aditivo, sem efeito em nenhum
> consumidor atual (`executive-overview`/`narratives-exploration`/
> `electoral-themes` herdam o default, comportamento inalterado). Mudou a
> aridade da function (6→7 parâmetros), então a migration usa `drop
> function` explícito pela assinatura antiga antes de recriar — mesmo
> cuidado já documentado em `CLAUDE.md` para a mudança de aridade de
> 2026-07-21. Consumido por
> [../communications/narrative-impact-tracking.md](../communications/narrative-impact-tracking.md)
> (`get_communication_impact`), que ancora Momentum/Tendência/Risco/
> Sentimento numa data histórica (antes/depois de uma Comunicação/Decisão)
> em vez de sempre "agora".
>
> ⚠️ **Bug real de overload duplicado, encontrado e corrigido (2026-07-14,
> migration `20260731040000`)**: a migration seguinte na mesma sessão de
> `20260726010000` (`20260726020000`, o fix de sentimento "proportion
> only") recriou `get_narratives_table` com **6** parâmetros via `create
> or replace` sem `drop function` prévio — como a assinatura de 6
> parâmetros tinha acabado de ser dropada por `20260726010000` (que já
> tinha migrado corretamente pra 7), esse `create or replace` **criou um
> novo overload** em vez de substituir, deixando dois `get_narratives_table`
> conflitantes no catálogo (6 e 7 parâmetros), divergentes entre si (o de
> 7 nunca ganhou `category_label` nem o fix de sentimento). Toda chamada
> via PostgREST (`get-page-overview`/`get-page-narratives`/
> `get-narrative-detail`, que passam sempre 6 argumentos nomeados, nunca
> `p_reference_at`) ficava sujeita a uma resolução de overload ambígua,
> causando `narratives: []`/`ui_meta.narrative: null` silenciosos no
> envelope (erro capturado pelo `try/catch` de `fetchNarratives`/
> `fetchNarrativeSummary`, nunca propagado). `get_communication_impact` não
> era afetado — chama com `p_reference_at =>` nomeado explicitamente, o
> que resolve sem ambiguidade contra o overload de 7 parâmetros mesmo com
> os dois coexistindo. Corrigido consolidando em UM ÚNICO
> `get_narratives_table` de 7 parâmetros (drop dos dois antigos + create),
> reunindo `category_label`/sentimento "proportion only" com
> `p_reference_at` na Tendência. Ver `CLAUDE.md`, "`/narratives` retornando
> vazio...", pro relato completo do diagnóstico.

| Faixa | Rótulo |
|---|---|
| 0–39 | ↓ Tendência de queda |
| 40–59 | → Estável |
| 60–100 | ↑ Tendência de alta |

<details>
<summary>Histórico — "Velocidade" (fórmula usada de 2026-07-13 até 2026-07-22)</summary>

> Recomendação do usuário (2026-07-13): "separar Momentum de Velocidade —
> Momentum deveria representar a força da narrativa... Velocidade
> representaria sua taxa de crescimento [recente]... evita uma narrativa
> com alto Momentum mas baixa Velocidade (já estabilizou) ser confundida
> com uma de baixo Momentum mas alta Velocidade (tendência emergente)."

Diferente de Momentum (período selecionado na tela), Velocidade era sempre
**curto prazo e independente do filtro de período** — media se a narrativa
estava esquentando ou esfriando *agora*, não no período que o usuário
escolheu olhar:

```sql
-- soma de total_mentions das últimas 3h vs. as 3h imediatamente anteriores,
-- de bw_query_metrics_hourly (grão horário, ver foundation/data-model.md)
velocity_score = norm_growth(total_mentions_last_3h, total_mentions_previous_3h)
```

| Faixa | Rótulo |
|---|---|
| 0–19 | ↓ Encolhendo rapidamente |
| 20–39 | ↘ Diminuindo |
| 40–59 | → Estável |
| 60–79 | ↑ Crescendo |
| 80–100 | ↗ Viralizando |

Substituída em 2026-07-22 pela Tendência acima — ver justificativa
completa lá.

</details>

### Risco (0-100) — prioridade operacional

"Prioridade operacional calculada pela combinação de Sentimento, Momentum,
Velocidade, alcance, influência dos autores e impacto potencial" (definição
original do usuário, 2026-07-13 — a fórmula não mudou quando Velocidade
virou Tendência, só a fonte de um dos termos, ver nota abaixo). Composto,
sem chamada nova à Brandwatch — reusa Momentum e Tendência já calculados
acima, mais 3 componentes normalizados para 0-100:

```sql
-- sentiment_risk: inverte net_sentiment (-100..100) pra uma escala de risco (0..100)
sentiment_risk = greatest(0, least(100, (100 - net_sentiment) / 2.0))

-- reach_risk / impact_risk: percentil dentro das Narrativas da MESMA Query no mesmo período
-- (reach/engagement absolutos variam demais entre organizações pra usar um limiar fixo)
reach_risk = reach_estimated * 100.0 / nullif(max(reach_estimated) over (partition by query_id, period), 0)
impact_risk = engagement_total * 100.0 / nullif(max(engagement_total) over (partition by query_id, period), 0)

-- author_influence: % dos top authors da Narrativa (bw_query_top_authors filtrado por
-- category_id) que são is_influential (nativo, followers >= 100k, ver foundation/data-model.md)
author_influence = count(*) filter (where is_influential) * 100.0 / nullif(count(*), 0)

-- ✅ sentiment_dampener (2026-07-25, decisão #3 de _pending.md): amortece
-- a contribuição conjunta de Momentum+Tendência quando o sentimento é
-- líquido positivo — nunca abaixo de 50% do peso original, nunca acima
-- de 100% (sentimento negativo/neutro não amplifica).
sentiment_dampener = least(1, greatest(0.5, sentiment_risk / 50.0))

risk_score = round(
  0.25 * sentiment_risk +
  sentiment_dampener * (0.25 * momentum_score + 0.20 * trend_score) +
  0.15 * reach_risk +
  0.10 * author_influence +
  0.05 * impact_risk
)
```

> ✅ **Nota sobre a troca Velocidade→Tendência (2026-07-13)**: o pedido do
> usuário foi explícito que Risco e Momentum "se mantém" como indicadores
> — não foi dito o que fazer com o termo de 20% que `risk_score` sempre
> leu de `velocity_score`. Decisão tomada (a leitura mais conservadora,
> registrada aqui por não ter sido abordada diretamente no pedido): manter
> a forma/pesos da fórmula intactos, só trocando a fonte desse termo de
> `velocity_score` pra `trend_score` (mesma escala 0-100, mesmo 50=neutro)
> — `risk_score` continua sendo "Sentimento + Momentum + crescimento
> recente + alcance + influência + impacto", só que o sinal de
> "crescimento recente" agora vem de uma regressão de 14 dias em vez de um
> snapshot de 3h.

| Faixa | Situação | Cor |
|---:|---|---|
| 0–33 | Baixo | 🟢 verde |
| 34–59 | Moderado | 🟡 amarelo |
| 60–84 | Alto | 🟠 laranja |
| 85–100 | Crítico | 🔴 vermelho |

✅ **Resolvido (2026-07-25, migration `20260725000000`, decisão #3 de
`_pending.md`)** — a fórmula acima já inclui o termo de interação: a
contribuição conjunta de Momentum+Tendência (`0.25 * momentum_score +
0.20 * trend_score`, 0.45 do total) é multiplicada por um
`sentiment_dampener = least(1, greatest(0.5, sentiment_risk / 50.0))`.
Efeito: sentimento líquido negativo/neutro (`sentiment_risk >= 50`) →
dampener = 1, fórmula idêntica à v1; sentimento líquido positivo →
dampener cai linearmente até um piso de 0.5 (nunca zera — uma Narrativa
virótica ainda pesa risco, só metade do peso de uma virótica negativa).
Pedido do usuário: "Implementar termo de interação agora".

- `narratives.risk_level` (enum manual, `low`/`medium`/`high`/`critical`)
  **continua existindo no schema**, mas deixa de ser o que a coluna Risco
  da tabela mostra por padrão — vira um override manual opcional que uma
  spec futura pode expor (ex: "marcar risco manualmente", sobrepondo o
  score calculado). Não removido, só não é mais a fonte primária da UI.
- Nenhum dos 4 scores (Sentimento/Momentum/Tendência/Risco) é
  armazenado — todos calculados sob demanda dentro de
  `get_narratives_table`, mesmo padrão de `sov_percent`/`trend_percent` já
  existentes na view.
- `event-radar` (1.1-1.4/1.6 implementados desde 2026-07-27/31 — ver
  `CLAUDE.md`): `severity_score` de um evento ativo para a Narrativa é
  conceitualmente próximo de `risk_score` (pesos parecidos —
  volume/sentimento/tendência/alcance/autores), mas é um score irmão,
  calculado por uma fórmula diferente (por evento transiente, não por
  Narrativa) — **`get_narratives_table` não recalcula nada a partir
  dele**. O ponto de integração é aditivo: quando a Narrativa tem um
  evento ativo publicado pelo radar, `risk_score = greatest(risk_score
  calculado acima, severity_score do evento ativo)` — um evento detectado
  só pode elevar o risco mostrado, nunca derrubá-lo. ✅ **Decisão
  confirmada (2026-07-25)**, mesma fórmula já registrada em
  [../event-radar/aggregated-metrics-integration.md](../event-radar/aggregated-metrics-integration.md)
  desde 2026-07-13 — ver também
  [../event-radar/severity.md](../event-radar/severity.md), "Relação com
  `risk_score`".
  ⚠️ **Precisão adicionada (2026-08-02)**, ao revisar `fluxo-aggregated-metrics.md`
  antes de liberar esta etapa (Fase B): "evento ativo publicado pelo radar"
  significa **`feed_events`**, nunca `radar_staging_events` diretamente —
  um evento com `should_publish: false` (1.4) nunca chegou a ser
  publicado, então não deve contar pro boost de risco, mesmo tendo
  `severity_score` calculado em `radar_staging_events`. Fonte exata:
  `MAX(feed_events.severity_score)` entre as linhas com
  `related_narrative_id = narrativa` e `closed_at IS NULL` (uma Narrativa
  pode ter mais de um evento ativo simultâneo — ex: um de volume e um de
  sentimento — daí o `MAX`, nunca a soma). `feed_events.severity_score` é
  mantido sincronizado com o `radar_staging_events` de origem enquanto o
  evento segue ativo (migration `20260802000000`, ver
  `fluxo-aggregated-metrics.md`) — sem essa sincronização, o boost leria um
  valor congelado no momento da publicação, não o score real e atual.
  **Ainda não implementado** (esta function `get_narratives_table` em si
  não tem o termo `greatest(...)` ainda) — a fórmula de `risk_score` acima
  reflete o estado atual, sem esse termo; ele entra na mesma migration que
  ligar `get_active_highlights` (A1/A2 da Fase B, `fluxo-aggregated-metrics.md`).

### Campos do card de Narrativa (2026-07-21, migration `20260721010000`)

✅ **Implementado** — pedido do usuário: redesenhar todo card de Narrativa
(lista de Narrativas, "Top 3 Narrativas" da Visão Geral) seguindo uma
referência visual, com borda colorida por sentimento, SOV+menções, barra
de risco, texto de resumo e barra de sentimento positivo/neutro/negativo.
`get_narratives_table` ganhou 5 colunas de saída além das já existentes:

- `sentiment_positive_pct`/`sentiment_neutral_pct`/`sentiment_negative_pct`
  (`numeric`, 0-100): split completo de `narrative_metrics.sentiment_positive/
  neutral/negative` somado no `period_start`/`period_end` pedido,
  normalizado por `(pos+neu+neg)` — **nunca** por `total_mentions` (mesmo
  cuidado do fix de `sentiment_bucket` em `20260720000000`, que corrigiu
  exatamente essa diluição). Mesma base numérica de
  `get_narrative_sentiment_breakdown` (`20260717000000`), só que devolvida
  por linha da tabela de Narrativas em vez de uma breakdown à parte.
- `summary` (`text`, nullable): `narratives.description` — campo já
  reservado desde `foundation/narratives.md` ("Resumo executivo"), sem
  produtor ainda (`ai-synthesis`, Sprint 2 tardia/Sprint 3, não
  implementado). Sempre `null` hoje; o frontend (`NarrativeCard`) já lê e
  exibe o campo com um estado "resumo ainda não disponível", pronto para
  quando essa sprint futura popular a coluna sem precisar mudar o
  contrato do envelope de novo.
- `tags` (`text[]`): top 6 termos/hashtags de `bw_query_topics`
  (`topic_type in ('hashtags', 'phrases', 'words')`) por Narrativa, na
  semana mais recente sincronizada para a Category/Subcategory —
  agregado oficial já existente (`foundation`, "Novos aggregate tables"),
  nunca amostrado. ⚠️ **Não inclui um marcador de "emoção"** — a
  referência visual do pedido tinha um chip "emoção: raiva", mas não
  existe fonte não-amostrada para "emoção dominante da Narrativa":
  `bw_query_topics`/`data/topics` não tem dimensão de emoção, e
  `mentions.emotion` é um sinal *por mention*, best-effort, e usá-lo
  agregado violaria a premissa de "nunca calcular localmente sobre
  `mentions` amostrada" (ver `CLAUDE.md`). Se o produto quiser esse chip,
  é candidato natural para `summary`/`ai-synthesis` (classificação feita
  pela IA sobre o conjunto já sincronizado), não um cálculo local novo.

A barra de risco do card usa a mesma cor/faixa de `risk_label`
(`_design-tokens.md`) já usada pelo badge ao lado do título — não uma
paleta nova. A borda esquerda do card usa só 3 estados (verde/vermelho/
neutro, não as 7 faixas finas de `sentiment_label`) — pedido explícito do
usuário ("variação entre vermelho, verde ou neutro").

✅ **`category_label` adicionado (2026-07-25, migration `20260725050000`)**
— pedido do usuário: "os cards que ficam abaixo [na página de Narrativas],
devem ser organizados pela categoria." `get_narratives_table` ganhou mais
uma coluna de saída, `category_label` (`text`, nunca `null`): o nome da
Category-pai da Subcategory (`bw_categories.parent_id` — a Pauta/tema a
que a Narrativa pertence), resolvida via a mesma tabela/coluna já usada
por `pautas_root_category_id()` e pelos escopos `'leaves'`/`'pautas'`
desta função — nenhum dado novo, só nunca tinha sido devolvido por esta
function. Para uma linha de escopo `'roots'` (Category de topo, sem pai —
não usado por `/narratives` hoje, mas possível para outras páginas), cai
no próprio nome da Category. Consumido pelo frontend
(`NarrativeCategoryLanes`, ver `intelligence-center/narratives-exploration.md`,
"Interface (UI)") para agrupar os cards da lista de Narrativas por
categoria — nenhum outro consumidor lê este campo hoje (a tabela
interativa de Narrativas continua sem coluna de categoria, fora de
escopo deste pedido).

## Regras de negócio

- Granularidade automática da série temporal (`get_volume_trend`): reusa a mesma regra já
  especificada em `foundation/overview.md` para o gráfico de volume do Executive Overview — não
  duplicar a lógica com valores diferentes (ex: "≤7 dias por dia, >31 dias por semana" já existe
  lá; esta function só aplica a mesma regra escolhendo entre `bw_query_metrics_daily`/`weekly`/
  `monthly` conforme o grão resultante, para não recalcular semanas/meses somando dias na mão
  quando o agregado oficial daquele grão já existe). ✅ **Exceção adicionada (2026-07-19)**:
  período de exatamente 1 dia (`period_end - period_start = 0`, o modo "Diário" do header — ver
  `header-context.tsx`, `PERIOD_MODE_DAYS.daily = 1`) usa grão `hour` em vez de `day` —
  `bw_query_metrics_hourly` (`foundation/data-model.md`), não coberto pela regra original (que só
  distinguia day/week/month). Sem exceção, "Diário" sempre caía no grão `day` e devolvia 1 único
  ponto (o dia inteiro somado) — inútil como série temporal, achado direto pelo usuário na tela.
- Toda function deve respeitar RLS por `organization_id` (nunca confiar apenas no filtro passado
  por parâmetro — a policy de RLS é a garantia real, mesmo padrão de todas as tabelas de
  `foundation`). Para isso valer de fato, **nenhuma function deste módulo é `security definer`**
  — todas rodam com o privilégio de quem chama (`security invoker`, o default do Postgres), e o
  client que a Edge Function usa é autenticado como o usuário real, não a chave secreta — ver
  [edge-functions-per-page.md](edge-functions-per-page.md), "Autenticação do client Supabase".
- `get_narratives_table`/`get_theme_breakdown` aceitam um filtro opcional de `pauta_id`
  (= `narratives.id` de uma Narrativa), herdado do modelo original desta spec — hoje sem
  consumidor real (ver nota de escopo abaixo: uma pauta é sempre folha, sem filhas pra abrir).
- ✅ **`get_narratives_table` ganhou `p_scope` (2026-07-16, migration `20260716010000`)**:
  `'roots'` (só Narrativas cuja Category é de topo) | `'leaves'` (só Narrativas-filhas/Subcategory)
  | `null` (sem restrição). Só tem efeito quando `p_pauta_id` está ausente — com
  `p_pauta_id` setado, o comportamento existente (Narrativas-filhas daquela Pauta específica)
  continua tendo prioridade. Ambas as functions também passaram a
  exigir `bw_categories.status = 'active'` — Narrativas cuja Category saiu do Brandwatch (ver
  `foundation/data-model.md`, "bw_categories.status") somem da listagem por padrão.
  ✅ **Revisto (2026-07-20), depois revertido no dia seguinte (2026-07-21)**: 2026-07-20 tinha
  feito Overview/Narrativas usarem `p_scope => null` (Category+Subcategory juntas, viabilizado
  por um título composto "Categoria - Subcategoria"). Pedido do usuário 2026-07-21: "Para
  facilitar vamos considerar apenas as subcategorias em todas as narrativas. Retire a regra de
  'categoria - subcategoria'." Estado atual (`narrativesScopeForPage()`, `service-layer-aggregation.md`):
  **toda** página usa `'leaves'` (só Subcategory, nunca a Category raiz junto na mesma lista) —
  Overview, Narrativas, Plataformas e Relatórios; `themes` (Pautas Eleitorais) usa um terceiro
  valor, `'pautas'` — só Subcategories cuja Category-pai é especificamente a Category raiz
  chamada "Pautas" (`pautas_root_category_id()`, migration `20260721030000`), não qualquer
  Category raiz do Project. `'roots'` e `null` deixaram de ter qualquer chamador — mantidos na
  function só por retrocompatibilidade de assinatura, sem uso ativo.
- ✅ **`pautas_root_category_id(organization_id)` (2026-07-21, migration `20260721030000`)**:
  resolve o `id` da Category raiz da organização nomeada literalmente "Pautas"
  (`bw_categories.parent_id is null`, `lower(btrim(name)) = 'pautas'`, `status = 'active'`) —
  convenção de nome, mesmo padrão já usado no projeto pra vincular `narratives.title` a uma
  Category (`brandwatch-setup.md` §5), não uma coluna/flag dedicada. Retorna `null` se a
  organização ainda não tem essa Category configurada — toda function consumidora (abaixo) trata
  isso como "sem pautas", nunca como erro. Usada por `get_theme_breakdown`,
  `get_narratives_table(p_scope => 'pautas')` e `get_authors_ranking(p_scope => 'pautas')`.
- ✅ **`get_authors_ranking` ganhou `p_scope` (2026-07-21, migration `20260721030000`)**: mesmo
  valor `'pautas'` de `get_narratives_table`, pedido do usuário ("em Autores e comunidades por
  pauta deve aparecer apenas os autores que citaram algo relacionado às Pautas e deve ser
  informado a que pauta ele está associado, e poderá ser mais de uma"). Quando setado, escopa
  `bw_query_top_authors`/`bw_query_top_tweeters` às Subcategories de "Pautas" (em vez da Query
  inteira/1 Narrativa via `filters.narratives`) e agrupa o resultado por autor — um autor pode
  aparecer sob mais de uma pauta, então a function soma reach/engajamento entre as pautas em que
  ele tem atividade (⚠️ pode inflar levemente se uma mesma mention estiver categorizada em mais de
  uma pauta simultaneamente na Brandwatch — mesmo trade-off já aceito em toda soma sobre
  agregados por-Category deste projeto) e devolve a nova coluna `narrative_labels text[]`: os
  títulos de todas as pautas em que aquele autor apareceu no escopo pedido, sempre array (nunca
  `null`). Fora do escopo `'pautas'`, o agrupamento por autor é inofensivo (só 1 Category pode
  bater por vez hoje: Query inteira ou 1 Narrativa via `filters.narratives`) — nenhuma outra
  página muda de comportamento, só passa a receber `narrative_labels` preenchido honestamente em
  vez de nunca ter essa informação.
- `get_dissemination_graph` é a única function que recebe um `narrative_id` obrigatório em vez
  de `filters` — ela nunca deve ser chamada para múltiplas narrativas ao mesmo tempo (grafo é
  sempre por narrativa individual, para não gerar payload gigante).
- `get_active_highlights` NUNCA deve reimplementar as regras de detecção do radar (z-score,
  variação %, janelas de comparação). Se um bloco `highlights` parecer "vazio demais" numa
  página, o ajuste é no `event-radar` (thresholds, regras), não uma nova lógica de detecção
  duplicada aqui.

## Dados envolvidos

- **Lê**: `bw_query_metrics_daily`/`weekly`/`monthly`/`hourly` (este último só pro
  grão `hour` de `get_volume_trend` — `get_narratives_table.trend_score` usa a
  série diária de `narrative_metrics`, não o grão horário, ver "Tendência"
  acima), `bw_query_metrics_daily_by_platform`,
  `bw_query_topics`, `bw_query_top_authors` (ranking de autores e, via `is_influential`, o
  componente `author_influence` de `risk_score`), `bw_query_top_tweeters`, `narratives`,
  `narrative_metrics`, `bw_categories`, `feed_events`; `mentions` só por-linha, nunca agregada
  (ver "Regra fundamental" acima); `entity_accounts`/`entities`/`entity_tags` (`entities`,
  [entities/data-model.md](../entities/data-model.md)) como enriquecimento opcional de
  `authors`, ✅ implementado 2026-08-01 — ver [entities/author-linking.md](../entities/author-linking.md).
- **Escreve**: nenhuma — todas as functions são somente leitura (`STABLE` no Postgres).

## Referências relacionadas

- [overview.md](overview.md)
- [standard-json-envelope.md](standard-json-envelope.md)
- [service-layer-aggregation.md](service-layer-aggregation.md)
- [../foundation/data-model.md](../foundation/data-model.md)
- [../intelligence-center/narratives-exploration.md](../intelligence-center/narratives-exploration.md) — grafo simplificado, mesma fonte
- [../intelligence-center/electoral-themes.md](../intelligence-center/electoral-themes.md) — definição de "Pauta"
