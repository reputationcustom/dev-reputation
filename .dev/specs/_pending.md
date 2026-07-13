---
tipo: pending-tracker
atualizado: 2026-07-24 (rev. 17)
---

# Pendências — Digital Intelligent Communication

> Agregador de tudo que está marcado `⚠️ DECISÃO PENDENTE` (decisão de produto, alguém precisa
> responder) ou "especificado, ainda sem migration/implementação" (trabalho técnico já
> desenhado, só falta escrever o código) em qualquer spec do projeto. **Não é uma fonte nova de
> verdade** — cada linha é só um ponteiro pro lugar onde a pendência de fato está documentada
> (a spec continua sendo a fonte real). Atualizar sempre que uma pendência for aberta ou fechada
> em qualquer spec — mesma disciplina já usada pra manter `_architecture.md`/`_index.md`
> sincronizados.
>
> Pra "o que falta implementar de cada módulo inteiro" (não uma pendência pontual), ver
> [_architecture.md](_architecture.md) — a coluna Status ali já responde isso. Este arquivo é só
> pra decisões/gaps específicos, não pra status de módulo.

## Como usar

- **Quer decidir algo?** Escolha uma linha em "Decisões de produto pendentes", responda no chat
  (ex: "resolve a pendência de X: a resposta é Y") — a spec é atualizada e a linha sai daqui.
- **Quer saber o que falta codar?** "Gaps técnicos" lista specs já prontas sem migration/código
  correspondente — dá pra pedir "implemente a pendência de net_sentiment" direto.

## Decisões de produto pendentes

| # | Módulo | Decisão | Spec |
|---|---|---|---|
| 3 | `aggregated-metrics` | Fórmula de `risk_score`: adicionar termo de interação pra não inflar risco quando Momentum/Tendência altos vêm com sentimento positivo (v1 é soma simples) | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md), "Scores de Narrativa" |
| 5 | `event-radar` | UI de aprovação (aceitar/rejeitar) de `cases` pendentes `high`/`critical` — ainda sem spec própria, bloqueia só esse passo específico de `schema-integration.md` | [event-radar/schema-integration.md](event-radar/schema-integration.md) |

✅ **Resolvida 2026-07-24** (decisões #1 e #4, e um pedido adicional do
mesmo turno, todos na mesma sessão do usuário): "1) faça Modal [pra
`/narratives/[id]`] e se o usuário quiser ele irá para a tela com mais
detalhes, deixa essa opção no modal. 2) [Intervalo do pg_cron do motor de
detecção] Manter em 15min. 3) Vamos retirar a opção de velocidade em
narrativas e substituir por tendência... Dessa maneira os indicadores se
mantém como risk_score e momentum."
- **Decisão #1 (modal)**: implementado exatamente como
  `narratives-exploration.md` já especificava desde 2026-07-12 — parallel
  route `@modal` + intercepting route `(.)narratives/[id]`
  (`app/(intelligence-center)/(analytics)/@modal/(.)narratives/[id]/page.tsx`),
  componente único (`narrative-detail-content.tsx`) reusado pela página
  cheia e pelo modal, modal com link "Abrir página completa" (pedido
  explícito: "deixa essa opção no modal"). Fecha também o gap técnico #16
  abaixo (mesma pendência, listada nas duas tabelas).
- **Decisão #4 (pg_cron)**: 15 minutos, mesmo intervalo já usado pelo
  heartbeat de `bw-sync`. Ver `event-radar/detection-engine.md`, "Fluxo
  principal" item 1.
- **Velocidade → Tendência** (pedido novo, não numerado nesta tabela):
  `get_narratives_table` (migration `20260722010000`) troca
  `velocity_score`/`velocity_label` (snapshot 3h-vs-3h, 5 rótulos) por
  `trend_score`/`trend_label` (regressão linear de 14 dias sobre
  `narrative_metrics.total_mentions`, 3 rótulos —
  decreasing/stable/increasing). `risk_score` e `momentum_score`
  continuam exatamente como indicadores, sem mudança de forma (pedido
  explícito do usuário) — `risk_score` só troca a *fonte* do termo de 20%
  de "crescimento recente" (antes `velocity_score`, agora `trend_score`,
  mesmo peso/papel na fórmula — decisão não coberta diretamente pelo
  pedido, registrada como a leitura mais conservadora em
  `sql-aggregation.md`, "Risco"). A decisão #3 acima (termo de interação
  no `risk_score`) continua aberta, só com a terminologia atualizada.
  Fecha também o gap técnico #26 abaixo (rename que tinha ficado
  incompleto/não commitado numa sessão anterior).
Ver `CLAUDE.md` para o detalhamento completo de cada um dos 3 itens, e
`aggregated-metrics/sql-aggregation.md`/`intelligence-center/{executive-overview,
narratives-exploration,electoral-themes}.md`/`_design-tokens.md`/`_glossary.md`
para as specs atualizadas.

✅ **Resolvida 2026-07-13** (decisão #6, `auth`): implementado o reforço que
a própria spec recomendava — `admin-revoke-user-access` agora verifica
`user_profiles.is_principal` e recusa `revoke: true` para essa conta,
além da UI já ocultar a ação nessa linha. Ver `auth/user-management.md`
("Regras de negócio") e `CLAUDE.md`, "Módulo auth (Sprint 2)".

✅ **Resolvida 2026-07-14** (decisão #2, `aggregated-metrics`): tipos TS do envelope ficam em pacote
compartilhado — `packages/shared-types` (`@reputation/shared-types`, primeiro workspace npm deste
repo), consumido pelo frontend via `next.config.ts`'s `transpilePackages`. Ressalva encontrada ao
implementar: isso resolve só o lado Next.js/frontend — Edge Functions continuam sem conseguir
importar um pacote de workspace local em produção (Princípio técnico 5), então
`supabase/functions-shared-source/aggregated-metrics-service.ts` mantém sua própria cópia inline
dos tipos, sincronizada à mão. Ver `CLAUDE.md`, "aggregated-metrics module (Sprint 2)".

✅ **Resolvida 2026-07-16** (pedido do usuário, não numerada — surgiu na
sessão, não vinha de nenhum item desta tabela): "as categorias permanecem
mesmo quando excluídas da brandwatch... status passa para inativo" e
"overview apenas a categoria, narrativas as subcategorias, pautas todas as
subcategorias da categoria Pauta". `bw_categories.status` (migration
`20260716010000`) + `get_narratives_table`'s novo `p_scope` — ver
`CLAUDE.md`, "bw_categories.status" e "Overview vs. Narrativas vs. Pautas
Eleitorais", e item #17 abaixo (parcialmente resolvido pelo mesmo
trabalho). Mesma sessão também corrigiu um bug de produção real de
rate-limit cross-invocation em `bw-sync` (migration `20260716020000`) —
ver `CLAUDE.md`, "bw-sync rate limit cross-invocation backoff".

✅ **Resolvida 2026-07-20** (pedido do usuário, não numerada): "1) O nome
da narrativa será composto por 'categoria - subcategoria'. 2) Tanto na
página de overview quanto na lista de narrativas serão mostradas todas as
narrativas. 3) Revise se os valores de sentimento por narrativa estão
corretos, no Frontend está tudo neutro, não corresponde a realidade."
Reverte a decisão de 2026-07-16 logo acima só pras páginas Overview/
Narrativas (`platforms`/`themes`/`reports` continuam em `'leaves'`/`'roots'`).
Título composto: `ensureNarrativesFromCategories()` (`bw-sync/index.ts`,
`buildNarrativeTitle()`) + backfill de todo `title` existente (migration
`20260720000000`). Bug de sentimento real encontrado e corrigido: o
fallback local de `sentiment_bucket` (`public.narratives_overview`, usado
só enquanto `net_sentiment` oficial não sincronizou) dividia por
`total_mentions` em vez de `(sentiment_positive + sentiment_negative)`,
enviesando o resultado pra 'neutral' sempre que havia uma fatia relevante
de mentions neutras/factuais; e `runDailyMetricsStep()` fazia as 2
chamadas de `net_sentiment` por último entre 10 chamadas fixas de
agregado, sob risco de nunca rodar quando o orçamento de 25
chamadas/invocação se esgotava antes — reordenado pra prioridade máxima
logo após o loop de sentimento. Ver `CLAUDE.md`, "Alteração da lógica de
definição da narrativa" e `foundation/narratives.md`.

✅ **Resolvida 2026-07-21** (pedido do usuário, não numerada — 3 pedidos na
mesma sessão): "1) Página Pautas Eleitorais deve focar apenas na categoria
Pautas, análise vinda de todas as subcategorias de Pautas. 2) Autores e
comunidades por pauta deve mostrar só autores que citaram algo relacionado
às Pautas, com a(s) pauta(s) a que cada um está associado. 3) Para
facilitar, considerar apenas as subcategorias em todas as narrativas — retire
a regra de 'categoria - subcategoria'." Reverte a decisão de 2026-07-20
logo acima (título composto, Overview/Narrativas com `p_scope => null`) e
corrige o modelo de "Pauta" que estava em vigor desde a criação desta spec
(qualquer Category raiz do Project contava como uma Pauta — errado, ver
`intelligence-center/electoral-themes.md`). Migration `20260721030000`:
`pautas_root_category_id()` (resolve a Category raiz literalmente chamada
"Pautas" por nome), `get_theme_breakdown`/`get_narratives_table` escopados
a Subcategories dela (`p_scope => 'pautas'`), `get_authors_ranking` ganha
`p_scope`/`narrative_labels`. `narrativesScopeForPage()` simplificado pra
`'leaves' | 'pautas'` (nenhuma página mais usa `'roots'`/`null`).
`buildNarrativeTitle()` volta a devolver só o nome simples + backfill
inverso do título. Ver `CLAUDE.md`, "Página Pautas Eleitorais: escopo
corrigido para a categoria Pautas".

✅ Resolvidas em 2026-07-13: `net_sentiment` oficial por Narrativa/Query
(gap técnico #1 de foundation, migration `20260713030000` — ver
[foundation/data-model.md](foundation/data-model.md)); tabela
`bw_query_metrics_hourly` + fase `hourly_metrics` (gap técnico #2 de
foundation, migration `20260713040000`); busca seletiva de `full_text`
top-N por Narrativa/dia (gap técnico #3 de foundation, fase
`full_text_enrichment`, sem migration — coluna já existia); extração de hashtag como campo estruturado (`mentions.insights_hashtag`
— e um bug real de matching corrigido junto); seletor de organização/Query — **organização é a
única unidade visível ao usuário**, Queries são sempre combinadas automaticamente e nunca
expostas (revisado 2× nesta mesma data — a primeira versão desta resolução tinha introduzido um
seletor de Query, corrigido pelo usuário no mesmo dia); "Post Type" — retirada, não fazia
sentido como pendência (a informação já é capturada, usada no grafo de disseminação, não num
painel agregado); síntese de página — assíncrona e armazenada em banco por período
(`page_narrative_synthesis`, período fechado = permanente); mapeamento de `case_status` — mantido
igual ao protótipo (`open`/`waiting`→Pendente, `in_progress`→Em andamento,
`resolved`/`archived`→Concluída).

✅ **Resolvida 2026-07-21** (pedido do usuário, não numerada): redesenhar
todo card de Narrativa (lista de Narrativas, "Top 3 Narrativas" da Visão
Geral) seguindo uma referência visual anexada, e corrigir a Edge Function
de Narrativas pra devolver todo o dado necessário no envelope, incluindo a
parte textual do card já preparada pra receber texto gerado por IA numa
sprint futura. `get_narratives_table` (migration `20260721010000`) ganhou
`sentiment_positive_pct`/`neutral_pct`/`negative_pct` (split completo,
mesma base de `get_narrative_sentiment_breakdown`), `summary` (=
`narratives.description`, campo já reservado desde `foundation/narratives.md`,
segue sem produtor até `ai-synthesis`) e `tags` (top termos/hashtags reais
de `bw_query_topics`). Novo `NarrativeCard` (`components/intelligence-center/
narrative-card.tsx`) reusado pela lista de Narrativas e por "Top 3
Narrativas" — o que também permitiu simplificar `TopThreeNarrativeCards`
(não precisa mais casar por título com uma breakdown separada) e remover
`'narrative'` de `PAGE_BREAKDOWN_TYPES.overview` (chamada RPC que ficou sem
consumidor nesta página). ⚠️ Sem marcador de "emoção" no card — nenhuma
fonte não-amostrada existe pra isso hoje (ver `sql-aggregation.md`, "Campos
do card de Narrativa"). Ver `CLAUDE.md`, `aggregated-metrics/sql-aggregation.md`
e `intelligence-center/narratives-exploration.md`.

✅ **Resolvida 2026-07-21** (pedido do usuário, não numerada: "tem ocorrido
muito esse erro ao executar a bw-sync, resolva em definitivo" — 429
recorrente em `daily_metrics`, ex: `/data/authors/categories/days`, mesmo
com o backoff reativo de `rate_limited_until` já em produção desde
2026-07-16). Causa raiz: aquele backoff só age DEPOIS que um 429 já
aconteceu (3 tentativas locais esgotadas) — nunca evita a falha em si, só
evita repeti-la. `callBrandwatch()` já lia o header oficial
`x-rate-limit-used` (contagem real da Brandwatch do teto de 30/10min por
Client) desde a implementação original, mas só para log. Migration
`20260721020000` + `bw-sync/index.ts`: esse valor agora também governa
`hasBrandwatchCallBudget()` (para novas chamadas assim que o uso real
reportado chega a 27/30, mesmo com orçamento local de sobra) e é
persistido em `bw_sync_lock` entre invocações (`last_rate_limit_used`/
`last_rate_limit_observed_at`, `record_bw_rate_limit_usage()`), checado
por um novo gate proativo (passo 0.5d) antes de mintar token — cobre o
cenário já documentado de invocações manuais de teste no Dashboard
somadas ao heartbeat de 15min, que o backoff puramente reativo não
prevenia. Ver `CLAUDE.md`, "bw-sync rate limit — gate proativo" e
`foundation/sync-brandwatch.md` passos 0.5d/8.

✅ **Resolvida 2026-07-22** (pedido do usuário, não numerada: "ainda com
problemas de rate limit... verifique se a busca está incremental e se há
algo a otimizar" — follow-up ao gate proativo de 2026-07-21, que estava
disparando corretamente mas só reagindo a um problema que persistia:
`daily_metrics` sozinha fazia até 14 chamadas fixas + 1 por Narrativa numa
única invocação, um burst grande demais pra janela real de 10min da
Brandwatch). Duas otimizações em `bw-sync/index.ts`, sem migration: (1)
consolidação via `data/multiAggregate/{dimension}/days` (endpoint oficial
confirmado ao vivo contra developers.brandwatch.com nesta sessão) — 14
chamadas fixas (reachEstimate/engagementScore/authors/impressions/
netSentiment × categories+queries, +4 de plataforma) viram 3; (2) o loop
de sentimento por Narrativa (não combinável — dimension1=sentiment já usa
as 2 dimensões permitidas) agora espalha por vários heartbeats via novo
`StepResult.stayOnStep`, capado a 8 chamadas reais por invocação com gate
de frescor de 25min. Ver `CLAUDE.md`, "daily_metrics call-count reduction"
e `foundation/sync-brandwatch.md`.

✅ **Resolvida 2026-07-22** (pedido do usuário, não numerada: "Permitir o
usuário a escolher qual organização é a default. Ele poderá alterar no
menu de seleção da organização"). `user_profiles.default_organization_id`
(migration `20260722000000`, nullable, `on delete set null`) + nova Edge
Function self-service `update-my-default-organization` (terceira escrita
self-service em `user_profiles`, valida pertencimento via
`organization_members` antes de gravar). Botão estrela no seletor de
organização (`page-header-bar.tsx`); `header-context.tsx` passa a preferir
a organização padrão ao carregar, com fallback pra primeira organização
quando nula ou quando o usuário não é mais membro dela. Corrigida de
passagem uma nota desatualizada em `_glossary.md` ("Organization Member")
que ainda dizia "troca de organização ativa pela UI continua fora do MVP"
— o seletor já existe desde o Sprint 2, só a nota nunca tinha sido
corrigida. Ver `CLAUDE.md`, "Default organization — self-service, third
user_profiles write" e `auth/data-model.md`.

✅ **Resolvida 2026-07-23** (pedido do usuário, não numerada: "Na edge
function bw-sync as categorias não estão sendo colocadas como inativas
quando não existem mais na brandwatch"). A lógica de desativação em si
(migration `20260716010000`) estava correta — o bug real era em QUANDO
ela tinha chance de rodar: `refreshMetadata()` só era chamada de dentro
de `runMetadataStep()`, disparado só quando `sync_cursors.next_step`
chegava na primeira fase de `SYNC_STEPS` (`"metadata"`), reavaliada de
novo só quando um ciclo inteiro de 16 fases fecha e dá a volta. Fases
"stale-gated" avançam no máximo 1 categoryTarget/grupo por invocação, e
`daily_metrics` também pode se estender por várias invocações desde
2026-07-22 (`stayOnStep`, burst de sentimento espalhado) — pra uma
organização com Narrativas suficientes, um ciclo inteiro podia levar bem
mais que `BW_SYNC_INTERVAL_HOURS` (3h) pra fechar, e o throttle de 1h de
`needsMetadataRefresh()` nunca tinha chance de ser reavaliado nesse meio
tempo. Corrigido em `bw-sync/index.ts`: a checagem (e o refresh de
verdade, quando devido) agora roda em toda invocação do par, independente
de qual fase está na vez — guardado por `hasBrandwatchCallBudget()` pra
não competir com o orçamento da fase corrente. Sem migration (mudança só
na Edge Function). Também ganhou log de sucesso
(`refreshMetadata:categories_deactivated`) — antes não havia nenhuma
confirmação nos logs de que a desativação rodava. Ver `CLAUDE.md`,
"Category deactivation wasn't actually running on any predictable
cadence" e `foundation/sync-brandwatch.md`/`data-model.md`.

## Gaps técnicos (spec pronta, sem migration/código ainda)

> Diferente da lista acima — estes não são decisões em aberto, é trabalho já desenhado esperando
> implementação. Em módulos que já têm outras partes implementadas (`foundation`), é fácil essas
> passarem despercebidas porque o módulo "parece pronto" — por isso ficam explícitas aqui.

### `foundation`

| # | O que falta | Spec | Observação |
|---|---|---|---|
| 5 | Cache do token Brandwatch no Vault (`brandwatch_credentials.access_token_secret_ref` write-back) | [foundation/brandwatch-setup.md](foundation/brandwatch-setup.md) | Gap conhecido de longa data, **não bloqueante** — `bw-sync` minta token novo a cada par "devido", já barato o bastante na cadência atual (`BW_SYNC_INTERVAL_HOURS`). **Deferido a pedido do usuário (2026-07-13)**: fora do escopo desta rodada de implementação, evolução futura quando necessário |

✅ Item #4 (`bw_query_topics.daily_series`/`page_type_breakdown`) removido
desta tabela em 2026-07-13 — auditoria encontrou que já estava
implementado desde a migration `20260712040000` (endpoint legado de
Topics, `syncLegacyTopicsData()`); o tracker só não tinha sido atualizado
na época. Itens #2/#3 resolvidos na mesma data (ver acima).

### Outros módulos

| # | Módulo | O que falta | Spec |
|---|---|---|---|
| 7 | `aggregated-metrics` | Tabela `page_narrative_synthesis` (armazenamento persistente da síntese de página) — spec pronta, sem migration | [aggregated-metrics/ai-synthesis.md](aggregated-metrics/ai-synthesis.md) |
| 8 | `aggregated-metrics` | `get_active_highlights` (bloco `highlights`) — depende de `feed_events`, populada por `event-radar` (Sprint 3, ainda `rascunho`, tabela não existe). Os outros 9 blocos do envelope já têm function SQL implementada (migration `20260714000000`); `fetchHighlights` na service layer já existe e retorna `[]` até essa function existir | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md) |
| 9 | `aggregated-metrics` | Breakdown por região/localização (`breakdowns` tipo `'region'`, pedido em `narrative_detail`/`sentiment`) — `bw_query_demographics_daily` existe (`foundation/data-model.md`) mas nenhuma function SQL do tipo `get_region_breakdown` foi especificada em `sql-aggregation.md`. `fetchOneBreakdown('region', ...)` na service layer já loga e retorna `null` (não quebra o envelope), só falta a function+wiring quando alguém confirmar o desenho (que dimensão de localização — país/estado/cidade? — e qual métrica exibir) | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md) |
| 10 | `aggregated-metrics` | Trend "volume por plataforma ao longo do tempo" (`platforms`) e "SOV por pauta ao longo do tempo" (`themes`) — `block-mapping-per-page.md` pede os dois, mas `sql-aggregation.md`'s `get_volume_trend` só cobre volume/sentimento geral, sem quebra por plataforma/pauta ao longo de uma série temporal (só como snapshot estático via `get_platform_breakdown`/`get_theme_breakdown`). `fetchTrends()` na service layer já loga e retorna `[]` pra essas 2 páginas em vez de inventar uma série | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md) |
| 11 | `aggregated-metrics` | `authors[].risk_level` sempre `null` — diferente de `narratives` (que tem a fórmula completa "Scores de Narrativa"), nenhuma spec define como calcular risco por autor individual. `get_authors_ranking` retorna `null` de propósito até uma spec futura definir a fórmula | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md) |
| 16 | `intelligence-center` | ✅ **Fechado (2026-07-24)**: implementado como modal via intercepting route (`@modal/(.)narratives/[id]/page.tsx`), exatamente como `narratives-exploration.md` decidira em 2026-07-12 — ver decisão #1 (resolvida) acima | [intelligence-center/narratives-exploration.md](intelligence-center/narratives-exploration.md), "Fluxo principal" item 5 |
| 17 | `intelligence-center` | ✅ **Fechado por não-aplicabilidade (2026-07-21)**: drill-down "narrativas dentro da pauta" não existe mais como conceito — o escopo de Pautas Eleitorais foi corrigido (`intelligence-center/electoral-themes.md`) pra "Pauta = Subcategory da Category raiz 'Pautas'", e uma Subcategory já é folha (a Brandwatch não suporta um 3º nível). Não há "narrativas dentro de uma pauta" pra abrir. Histórico do gap original (quando "Pauta" ainda significava "qualquer Category raiz"): `get_theme_breakdown`/`BreakdownItem` nunca carregaram um `id` de Pauta pro clique escopar `get-page-themes` com `pauta_id` — deixou de ser relevante com a correção de escopo | [intelligence-center/electoral-themes.md](intelligence-center/electoral-themes.md) |
| 18 | `intelligence-center`/`platform-analysis` | 4 widgets de `/platforms` sem fonte de dado (nenhuma function SQL cobre): evolução do volume por plataforma ao longo do tempo, narrativas dominantes especificamente por plataforma, velocidade de propagação por plataforma (variação % entre períodos por `page_type`), conteúdos de destaque (cards de mentions individuais) — todos renderizados como `<EmptyState />` explicando o motivo, não omitidos silenciosamente. ✅ **2026-07-13**: mais 2 gaps do mesmo tipo identificados na paridade com o protótipo e também deixados como `<EmptyState />` honesto (não fabricados): "Engajamento médio por publicação" e "Autores únicos por plataforma" — o dado (`unique_authors`/`engagement_score`) já existe em `bw_query_metrics_daily_by_platform`, mas `BreakdownItem` só expõe `label`/`value`/`pct`, sem esses 2 campos; precisaria de um novo shape de breakdown ou campos extras. O widget "Sentimento por plataforma" que existia antes em `/platforms` foi removido (duplicava o mesmo widget da página `/sentiment`) e substituído por "Participação por plataforma" (barras de `pct`, sem score de sentimento), igual ao protótipo original | [intelligence-center/platform-analysis.md](platform-analysis.md) |
| 19 | `intelligence-center`/`sentiment-analysis` | ✅ **Metade resolvida (2026-07-17)**: "Sentimento por Narrativa" agora tem function+bloco (`get_narrative_sentiment_breakdown`, breakdown `type = 'narrative'`) — o dado (`narrative_metrics.sentiment_*`) já existia, só faltava o wiring. Continua em aberto só "Menções que mais influenciaram o sentimento" (lista de mentions individuais, sem bloco correspondente no envelope) | [intelligence-center/sentiment-analysis.md](sentiment-analysis.md), [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md) |
| 20 | `intelligence-center`/`narratives-exploration` | Detalhe de Narrativa: "Menções relevantes" e "Ações e decisões" (`cases`) ficam `<EmptyState />` — a primeira por falta de bloco no envelope (nenhum dos 8 blocos padrão cobre "lista de mentions em destaque"), a segunda porque a tabela `cases` (`intelligence-center/data-model.md`) ainda não tem migration — spec já previa esse estado vazio explicitamente ("Nenhuma ação registrada ainda") enquanto `cases` não existir | [intelligence-center/narratives-exploration.md](narratives-exploration.md), "Ações e decisões" |
| 21 | `aggregated-metrics` | Cache de página (TTL 5min + invalidação por sync/refresh manual) não implementado — as 6 Edge Functions `get-page-*`/`get-narrative-detail` recalculam o envelope a cada chamada. Não bloqueia funcionalidade (cada chamada já é rápida — leitura de agregados já sincronizados, não de `mentions` cru), só custa mais chamadas RPC do que o necessário sob uso intenso | [aggregated-metrics/edge-functions-per-page.md](edge-functions-per-page.md), "Regras de negócio" |
| 22 | `intelligence-center`/`aggregated-metrics` | Card "Share of Voice por Query Group" da Visão Geral nunca foi construído — `get_metrics_cards` só retorna os 5 KPIs de `bw_query_metrics_daily` (`total_mentions`/`sentiment_*`/`reach_estimate`/`engagement_score`/`unique_authors`), sem function SQL nem bloco de envelope para SOV agregado por Query Group. Achado ao revisar `executive-overview.md` contra o código em 2026-07-16 | [intelligence-center/executive-overview.md](intelligence-center/executive-overview.md), "Cards de topo" |
| 23 | `foundation` | `bw_query_top_authors.sentiment_positive/neutral/negative` (e o mesmo em `bw_query_top_tweeters`) — mapeamento de `d.sentiment` da resposta de `data/volume/topauthors/queries` **nunca confirmado** contra a documentação real do endpoint (diferente de todo campo vizinho na mesma tabela, que tem nota de confirmação explícita). Risco real de ser sempre `0/0/0` em produção sem erro. Achado numa auditoria de sentimento por autor (2026-07-17) — `aggregated-metrics.get_authors_ranking` foi corrigida pra não ler mais estas colunas (usa `bw_query_author_topics` em vez disso), mas as colunas em si continuam sem confirmação/uso — revisar contra logs reais antes de reativar | [foundation/data-model.md](foundation/data-model.md), "bw_query_top_authors" |
| 24 | `aggregated-metrics` | `get_term_signals` mistura todo `topic_type` (`words`/`phrases`/`hashtags`/`entities`/`people`/`places`/`organisations`) num só ranking de "drivers" — nenhuma spec pediu filtrar só `phrases` (não é um gap de verdade), mas registrado caso o produto queira restringir no futuro | [intelligence-center/sentiment-analysis.md](sentiment-analysis.md) |
| 25 | `foundation`/`aggregated-metrics` | "Sentimento de narrativas predominantemente neutro" reportado de novo pelo usuário em 2026-07-21, mesma queixa da sessão de 2026-07-20 (migration `20260720000000`). Reauditado função por função nesta sessão (`narratives_overview.sentiment_bucket`, ordem de chamadas de `runDailyMetricsStep`, `get_narratives_table.sentiment_label`, `get_narrative_sentiment_breakdown`) — a correção de 2026-07-20 está corretamente implementada, nenhuma causa adicional encontrada por inspeção de código. Se persistir depois deste deploy, o próximo passo precisa de logs reais de produção de `bw-sync` (não disponível em nenhuma sessão até agora) pra confirmar se `net_sentiment`/`sentiment_positive`/`negative` estão realmente chegando em `bw_query_metrics_daily` pras Narrativas afetadas — não é mais uma questão de revisão de código | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md), [foundation/data-model.md](foundation/data-model.md) |
| 26 | `aggregated-metrics`/`intelligence-center` | ✅ **Fechado (2026-07-24)**: o rename `velocity_score`/`velocity_label` → `trend_score`/`trend_label` que tinha ficado incompleto (envelope.ts e a migration editados, consumidores não) foi terminado nesta sessão como parte da troca Velocidade→Tendência pedida pelo usuário (ver decisão resolvida acima) — todos os consumidores (`narratives/page.tsx`, `score-badges.tsx`, `narratives-table.tsx`, `narrative-detail-content.tsx`, `aggregated-metrics-service.ts`, as 6 Edge Functions `get-page-*`/`get-narrative-detail`) atualizados em conjunto. `npm run build` deve passar agora — reconfirmar antes do próximo deploy | `packages/shared-types/src/envelope.ts`, `app/(intelligence-center)/(analytics)/narratives/page.tsx` |

✅ Item #6 (`auth` — UI + Edge Functions) removido desta tabela: já estava
`implementado` desde 2026-07-13 (ver `CLAUDE.md`, "Módulo auth (Sprint
2)") — o tracker só não tinha sido atualizado depois do trabalho ser
concluído, mesmo tipo de defasagem já corrigida antes para itens de
`foundation`.

✅ **Item #12 resolvido parcialmente (2026-07-15)**: `/admin/users` e
`/perfil` movidos para dentro do route group `(intelligence-center)`
(`app/(intelligence-center)/admin/users/`, `app/(intelligence-center)/perfil/`)
— agora têm o mesmo shell (Sidebar/header/footer fixos, não remontam ao
navegar). Sidebar ganhou colapso/expansão («»/mobile drawer) persistente
entre navegações (estado vive no layout, que não remonta — App Router).
Footer mínimo adicionado. Restam itens #15 (breakpoint exato não
confirmado, ver nota abaixo — resolvido) — o resto do item #12 original
(menu ocultável com forma óbvia de reabrir, shell fixo) está feito.

✅ **Item #15 resolvido (2026-07-12)**: o protótipo real
(`claude.ai/design`, projeto "Protótipo frontend design", arquivo
`Comunicacao Inteligente.dc.html`) foi importado via `DesignSync` e
confere o breakpoint exato — `window.innerWidth < 900`, não o `lg`
(1024px) padrão do Tailwind usado na implementação de 2026-07-15.
Corrigido: `tailwind.config.ts` ganhou `theme.extend.screens.shell =
'900px'` (estende, não substitui, a escala padrão `sm/md/lg/xl/2xl`) e
`app/(intelligence-center)/layout.tsx` passou a usar `shell:`/`hidden
shell:flex` no lugar de `lg:`/`hidden lg:flex` para a troca
sidebar↔rail↔drawer-mobile. Mesma sessão também corrigiu 3 outras
divergências reais achadas na comparação com o protótipo: (1) o rail
colapsado do desktop mostrava a primeira letra do label de cada item
(`label.charAt(0)`) em vez de um dot — `Sidebar` agora renderiza um dot
de 8px com `title`/tooltip, igual ao protótipo; (2) a barra de
organização/período/Filtros (`PageHeaderBar`) não aparecia em
`/narratives/[id]`, único lugar sem ela — agora está presente como em
todas as outras páginas do protótipo; (3) o botão "Filtros" com o painel
de chips (Plataforma/Idioma/Região/Sentimento/Narrativa/Pauta/Tipo de
autor/Alcance/Nível de risco) não existia — adicionado a
`PageHeaderBar` como estado local, presentacional (sem `onClick` nos
chips, igual ao próprio protótipo — não é filtragem real, o backend só
resolve `filters.narratives` hoje). Também adicionado um passo `md:`
(768px) em todo grid de conteúdo que pulava direto de `grid-cols-1` para
`lg:grid-cols-2/3/4/5` nas 5 páginas de análise — no tablet (768–1023px)
essas seções ficavam forçadas a uma coluna só / cards de KPI
espremidos em 2 colunas, quando o protótipo (baseado em
`flex:1 1 <basis>px` + `flex-wrap`) já reflui bem antes de 1024px.

## Referências

- [_architecture.md](_architecture.md) — status por módulo (o que já existe vs. planejado).
- [_index.md](_index.md) — "Sequência de implantação — Sprint 2", mapa de módulos.
