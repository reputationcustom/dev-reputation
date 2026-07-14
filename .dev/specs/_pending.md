---
tipo: pending-tracker
atualizado: 2026-08-07 (rev. 39)
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

Nenhuma no momento — a última (#5, `event-radar`) foi retirada em 2026-07-25, ver nota logo
abaixo.

✅ **Decisão #5 retirada (2026-07-25)**, pedido do usuário: "retire a pendência e coloque todos
os tipos de evento publicando no feed_events." A UI de aprovação (aceitar/rejeitar) de `cases`
`high`/`critical` deixou de existir como conceito — `event-radar/schema-integration.md` não
cria mais linha pendente em `cases` para nenhuma severidade; todo evento aprovado pela IA
(`should_publish: true`) publica direto em `feed_events`, `low` a `critical`, sem gate humano
intermediário. `event-radar` deixou de depender de `intelligence-center`/`cases` por completo
(`overview.md`, "Dependências"). `feed_event_feedback` continua existindo, mas como
retroalimentação pós-publicação (útil/irrelevante/severidade errada/explicação incorreta), nunca
como aprovação prévia. Arquivos atualizados: `schema-integration.md`, `agent-orchestrator.md`,
`overview.md`, `fluxo-aggregated-metrics.md` (diagramas), `intelligence-center/data-model.md`
(nota de pendência de `organization_id` em `cases`, que citava esse fluxo como exemplo).

✅ **Gap #32 revertido (2026-08-07)** — usuário relatou "narrativas que tem o momento explosivo e
que não gerou nenhum evento no radar" e perguntou se Momentum está sendo considerado na detecção.
Confirmado como gap real: a decisão original do gap #32 (2026-07-24, abaixo) tirou a regra de
detecção por Momentum do escopo, mas isso deixou `event-radar` sem NENHUM caminho — direto ou
indireto — pra transformar um Momentum "Explosivo" (`momentum_score` ≥80) em evento, já que a
etapa 1.1 (`detection-engine.md`) só lê volume bruto/sentimento. Nova regra `event_type =
'momentum_spike'` (`20260807000000_event_radar_momentum_detection.sql`), só escopo `narrative`,
reaproveitando a mesma fórmula/pesos de Momentum já em produção e a própria faixa "Explosivo"
(≥80) como limiar — não uma segunda fórmula. Ver `event-radar/detection-engine.md` e
`aggregated-metrics/sql-aggregation.md` ("Momentum"). Mesma sessão, esclarecido um mal-entendido
de nomenclatura do usuário: "Velocidade" foi substituída por "Tendência" em 2026-07-22, não por
Momentum — Momentum sempre existiu separado, nunca foi tocado por aquela troca.

✅ **7 pedidos pontuais de UI/dado resolvidos (2026-07-25)**, mesma sessão,
usuário: "1) renomeie Top 3 Narrativas para Top 3 Narrativas por Menções.
2) inclua rótulos no gráfico Sentimento por narrativa. 3) coloque nome de
colunas na tabela Sentimento por plataforma/pauta/estado. 4) Sentimento
por estado pode ser representado em um mapa com rótulos e cores. 5)
Verifique por que Drivers positivos não estão aparecendo. 6) mover Perfis
relevantes/X Themes para Autores e Influenciadores. 7) Remover a tabela
Narrativas da página Plataformas."
- **1**: `TopThreeNarrativeCards` renomeado + critério trocado de `sov_pct`
  para `total_mentions` (ver `executive-overview.md`).
- **2**: `NarrativeSentimentList` ganhou rótulos "pos/neu/neg %" (ver
  `sentiment-analysis.md`).
- **3**: `ScoreList` virou uma `<table>` real com cabeçalho
  (Plataforma/Pauta/Estado + Participação + Sentimento) — ver
  `sentiment-analysis.md`.
- **4**: `BrazilSentimentMap` novo (SVG 27 estados, dataset público
  `click_that_hood`) — ver `sentiment-analysis.md`.
- **5**: bug real em `get_term_signals` (migration `20260726030000`) —
  corte único de `limit 50` por `trending` global esvaziava o bucket
  "positive" quando termos negativos/neutros cresciam mais rápido no
  período; agora rankeia top 20 dentro de cada bucket de sentimento — ver
  `sentiment-analysis.md`.
- **6**: nova página `/authors` (`get-page-authors`, primeira Edge
  Function nova desde `get-page-themes`) — "Perfis relevantes"/"X Themes"
  saíram de `/platforms` — ver
  [intelligence-center/authors-and-influencers.md](intelligence-center/authors-and-influencers.md)
  (spec nova) e `platform-analysis.md` (nota histórica). `_index.md`
  atualizado (`/authors` deixa de estar 100% bloqueada por `entities`).
- **7**: tabela "Narrativas" genérica removida do fim de `/platforms`
  (conteúdo extra além do protótipo original, não fechava nenhum gap real
  — "Narrativas dominantes por plataforma" continua um gap separado, ainda
  aberto) — ver `platform-analysis.md`.
`npx tsc --noEmit`/`npm run build` confirmados limpos. Migration
`20260726030000` e a nova Edge Function (`get-page-authors`) revisadas
manualmente, não rodadas contra um banco real — mesma limitação recorrente
de toda sessão sem credenciais de deploy.

✅ **Revisão de coerência de documentação — `event-radar` (2026-07-25)**,
pedido do usuário: "revise a documentação do módulo event-radar e verifique
se está coerente e conciso com tudo que já foi desenvolvido até agora. Se
houver pendências vamos resolvê-las." Módulo continua `rascunho`
(Sprint 3, não implementado) — nada de código mudou, só a documentação.
Achados e resoluções:
- **Contradição real entre specs, resolvida** — `aggregated-metrics/sql-aggregation.md`
  (seção Risco, editada em 2026-07-25 pelo trabalho do `sentiment_dampener`)
  dizia que `risk_score`/`severity_score` "não se fundem num só número",
  contradizendo a fórmula explícita já registrada desde 2026-07-13 em
  `event-radar/aggregated-metrics-integration.md`
  (`risk_score = greatest(risk_score calculado, severity_score do evento
  ativo)`). **Decisão do usuário: manter a fusão (`greatest`)** —
  `sql-aggregation.md` corrigido para descrever a mesma fórmula, deixando
  claro que ela ainda não está implementada (`event-radar` não existe) e
  entra na mesma migration que ligar `get_active_highlights`.
- **Gap de schema real, resolvido**: `event-radar` era o único módulo do
  projeto sem `data-model.md` — as colunas de `radar_staging_events`
  estavam espalhadas em 3 arquivos diferentes, e não havia coluna alguma
  documentada para o `event_type` granular (`volume_spike`/`sentiment_change`/
  etc.) que `standard-json-envelope.md` já espera em cada item de
  `highlights` — `schema-integration.md` só dizia "tipo/tag de evento
  'radar'", sem explicar onde esse dado granular ficaria guardado, dado
  que `feed_events.type` é o enum fixo e grosso `feed_event_type`. **Criado
  [event-radar/data-model.md](event-radar/data-model.md)**: consolida
  `radar_staging_events` (schema completo + índice único parcial para a
  chave de dedup), `feed_events` (nova coluna `event_type` text, separada
  do enum `type`, que resolve a ambiguidade) e nomeia pela primeira vez a
  tabela de feedback do analista (`feed_event_feedback`, mencionada em
  `schema-integration.md` desde 2026-07-12 sem nome definido).
  `schema-integration.md`/`detection-engine.md`/`severity.md`/
  `deduplication-grouping.md`/`volume-limits.md`/`agent-orchestrator.md`/
  `overview.md` todos ganharam referência cruzada para o arquivo novo.
- **Duas defasagens de doc (decisão já tomada, texto desatualizado)
  corrigidas**: `_index.md` ainda marcava o intervalo do `pg_cron` do
  radar como "⚠️ DECISÃO PENDENTE" apesar de já ter sido resolvido em
  2026-07-24 (15min, ver decisão #4 abaixo); o diagrama de sincronismo
  ainda dizia "momentum_score liga em severity_score" e "roda a cada
  15-30min", ambos desatualizados desde a redefinição de Momentum/Risco de
  2026-07-13 e a decisão de cadência de 2026-07-24 respectivamente.
- **Gap #32 (narrativas emergentes) resolvido no mesmo dia, fora de escopo em vez de
  pendência**: o usuário pediu para retirar "narrativas emergentes" do objetivo do módulo — o
  indicador `momentum_score` (`aggregated-metrics/sql-aggregation.md`) já representa esse sinal
  bem o suficiente, sem precisar de uma regra de detecção própria em `event-radar`. Removido de
  `overview.md` (Objetivo) e do gap registrado em `detection-engine.md`; não era uma regra
  faltando, era um objetivo que não deveria estar listado.
- **Movido, a pedido do usuário**: `.dev/specs/_fluxo-event-radar-aggregated-metrics.md`
  → [event-radar/fluxo-aggregated-metrics.md](event-radar/fluxo-aggregated-metrics.md)
  (era o único arquivo de fluxo cross-módulo solto na raiz de `.dev/specs/`
  em vez de dentro do módulo a que pertence) — diagrama de dependências
  (seção 1) redesenhado para mostrar a ordem de implementação 1.1→1.6
  lado a lado com qual tabela cada etapa lê/escreve, agora referenciando
  `data-model.md`. Todas as 4 referências a este arquivo (`_index.md`,
  `_architecture.md`, `event-radar/overview.md`,
  `event-radar/aggregated-metrics-integration.md`) atualizadas para o
  caminho novo na mesma sessão.
Nenhuma migration criada — módulo continua `rascunho`, sem código.

✅ **Resolvidas 2026-07-25** (decisões #28 e #30, `communications`, mesma
sessão, dois pedidos do usuário): "1) Permissão de CRUD de communications
sem restrição por enquanto, versões mais adiante será restrito por
perfis. 2) Tamanho padrão da janela de comparação antes/depois no
acompanhamento de impacto (proposta: 7 dias, configurável 3/7/14). Seguir
o recomendado." Decisão #28: sem restrição de papel/criador nesta
versão — qualquer membro da organização pode registrar/editar/excluir
qualquer Comunicação/Decisão; restrição por perfis fica como evolução
futura explícita, sem sistema de perfis definido ainda no produto pra
modelar agora (ver `communications/data-model.md`, "Políticas RLS").
Decisão #30: janela padrão de **7 dias**, com seletor 3/7/14 na tela —
`p_window_days` já é parâmetro das 2 functions propostas
(`get_communication_impact`/`get_narrative_communication_timeline`), os 3
valores já suportados sem mudança de schema (ver
`communications/narrative-impact-tracking.md`, "Conceito: janelas de
comparação").

✅ **Bug corrigido 2026-07-25** (`auth`/`intelligence-center`, report do
usuário: "Sempre que utilizo ctrl+r ele vai para a última organização
cadastrada e não para a que está marcada como default"). Condição de
corrida real em `header-context.tsx` entre `useOrganizations()` e
`useUserProfile()` (fonte de `defaultOrganizationId`, funcionalidade de
2026-07-22 abaixo): num reload frio, se a lista de organizações resolvesse
antes do perfil, o efeito de organização inicial travava em
`organizations[0]` (via seu guard `!organizationId`) usando um
`defaultOrganizationId` ainda no fallback `null`, e nunca reavaliava
quando o valor real chegava um instante depois. Corrigido com uma condição
extra no mesmo efeito, `userProfileStatus !== "loading"`. Sem mudança de
schema/Edge Function. A segunda parte do pedido ("mesmo limpando o cache,
deve continuar a organização default") já era verdadeira antes deste fix —
a preferência é lida do banco a cada carregamento, nunca de
`localStorage`. Ver `CLAUDE.md`, "Default organization — self-service,
third user_profiles write", bloco "Bug real encontrado e corrigido".

✅ **Resolvida 2026-07-25** (decisão #3, `aggregated-metrics`, resposta do
usuário nesta sessão: "Implementar termo de interação agora"): `risk_score`
ganhou um amortecedor (`sentiment_dampener = least(1, greatest(0.5,
sentiment_risk / 50.0))`) aplicado só à contribuição conjunta de
Momentum+Tendência (0.25+0.20 dos pesos) — nunca abaixo de 50% do peso
original (piso, uma Narrativa virótica ainda pesa risco, só menos que uma
virótica negativa), nunca acima de 100% (sentimento negativo/neutro não
amplifica, fórmula original intacta). Migration `20260725000000`. Ver
`aggregated-metrics/sql-aggregation.md`, "Risco".

✅ **Resolvidos 2026-07-25** (gaps técnicos #9/#10/#21/#27,
`aggregated-metrics`, mesma sessão de revisão de documentação — resposta
do usuário: "Implementar agora: país + net_sentiment" / "Trend de
plataforma/pauta ao longo do tempo" / "Cache de página (TTL 5min)" / "
Camada 0 de ai-synthesis (recomendado)"):
- **#9 (breakdown de região)**: `get_region_breakdown` (migration
  `20260725010000`), fonte `bw_query_demographics_daily`, `value`=`net_sentiment`
  médio ponderado, `pct`=participação de menções. ⚠️ Limitação real: essa
  tabela nunca teve `category_id` — só cobre o escopo "Query inteira",
  nunca uma Narrativa específica (`narrative_detail` sempre recebe vazio
  de propósito, não o dado errado mascarado). Frontend: widget "Sentimento
  por localização" em `/sentiment` trocado de `EmptyState` pra
  `BreakdownPanel` real. ✅ **Repivotado no mesmo dia (migration
  `20260725060000`)**: pedido do usuário "Precisamos de um breakdown por
  estado brasileiro" — checado contra `foundation`, que já sincroniza o
  dado necessário sem nenhuma mudança em `bw-sync`
  (`bw_query_demographics_daily.dimension_type='region'`, uma das 4
  dimensões de localização capturadas desde `20260711070000`, nunca antes
  exposta por function/bloco nenhum). `get_region_breakdown` passou a ler
  `dimension_type='region'` (estado) em vez de `'country'` — país deixou
  de ser exposto (baixo valor pra uma plataforma 100% de campanhas
  brasileiras). Widget renomeado pra "Sentimento por estado". ⚠️ Mesma
  ressalva desde que essa dimensão foi implementada: mapeamento exato de
  `regions` (dimensão de chart da Brandwatch) → UF brasileira nunca
  confirmado contra um payload real — revisar contra logs de produção
  quando houver acesso.
- **#10 (trend de plataforma/pauta ao longo do tempo)**:
  `get_platform_volume_trend`/`get_theme_sov_trend` (migration
  `20260725030000`), reagrupados localmente em semana/mês quando o
  período > 31 dias (sem agregado oficial semanal/mensal por
  plataforma/pauta na Brandwatch, só o diário — mesma classe de operação
  já aceita no projeto, nunca soma sobre `mentions` cru). Frontend:
  "Evolução do volume" em `/platforms` e novo widget "SOV por pauta ao
  longo do tempo" em `/themes`, ambos via `TrendLineChart`
  (`series_by_group`, um grupo por plataforma/pauta) — componente ganhou
  uma paleta de fallback com hash determinístico pra grupos fora do mapa
  fixo (nomes de plataforma/pauta não são conhecidos de antemão).
- **#21 (cache de página)**: tabela `page_cache` (migration
  `20260725040000`, TTL 5min via `expires_at`) + `getPageEnvelopeWithCache()`
  na service layer, chamada por todas as 6 Edge Functions no lugar de
  `assemblePageResponse()` direto. ⚠️ Escopo reduzido, documentado: só o
  TTL — invalidação antecipada por "sync concluiu um ciclo" ou "usuário
  clicou 'Atualizar dados'" **não** está implementada (nenhum dos dois
  gatilhos existe hoje no produto: `bw-sync` não conhece `page_cache`, e
  não existe botão "Atualizar dados" no header). Revisitar se isso passar
  a incomodar na prática.

✅ **Resolvida a instância deste gap em `ai-synthesis.md` (2026-07-14)** —
user report: "os resumos não estão atualizando até o momento" — uma linha
de período **aberto** já existente em `page_narrative_synthesis` era
devolvida como está pra sempre, sem nenhum dos 2 gatilhos "empurrados"
(sync concluir/"Atualizar dados") que o gap #21 acima já apontava como
inexistentes no produto. Em vez de esperar por esses gatilhos, o usuário
pediu um intervalo fixo: "vamos definir atualização a cada 3h." Nova
`AI_SYNTHESIS_REFRESH_HOURS` (default 3h, `aggregated-metrics-service.ts`)
+ `isNarrativeTextStale()` — `fetchNarrativeText()` agora dispara uma
recomposição em background sempre que a linha é de período aberto, não é
`custom`, e `generated_at` já passou da janela; puxado no próximo
carregamento de página, nunca um cron dedicado. Ver
`aggregated-metrics/ai-synthesis.md` pro detalhamento completo. **A
instância deste gap em `page_cache`** (TTL de resposta HTTP, mecanismo
independente, hoje desabilitado) **continua aberta** — não fazia parte
deste pedido.

✅ **Follow-up, mesmo dia** — usuário pediu 2 refinamentos: "esse resumo
executivo precisa acompanhar o radar, se aparecer algo novo no radar,
refaz o resumo executivo. Além disso, atualiza automaticamente de hora em
hora." `AI_SYNTHESIS_REFRESH_HOURS` default reduzido de 3h pra **1h**; novo
gatilho independente do tempo — `get_active_highlights` ganhou
`created_at` (migration `20260809040000`, `feed_events.created_at`, já
existia na tabela, nunca exposto) e `fetchNarrativeText()` agora também
recompõe quando algum highlight já buscado na mesma requisição tem
`created_at` mais recente que `page_narrative_synthesis.generated_at`
(`highlightsNewerThan()`) — "algo novo no radar" dispara independente da
janela de tempo ainda não ter vencido. `Highlight` (`@reputation/shared-types`
+ cópia inline Deno) ganhou `created_at: string`. Esclarecido pro usuário
que o resumo **por Narrativa** (`narratives.description`,
`narrative-summary-composer`) é um mecanismo diferente e já reage a
`feed_events` novos desde que foi criado (`narrative_summary_due_ids()`,
condição "c" — ver `foundation/narratives.md`) — não alterado nesta
sessão. Ver `aggregated-metrics/ai-synthesis.md` pro detalhamento
completo.
- **#27 (Camada 0 de `ai-synthesis.md`)**: `fetchNarrativeText()` na
  service layer — usa o `summary`/`explanation` de um highlight quando há
  exatamente 1 (hoje inalcançável, `get_active_highlights` ainda não
  existe, gap #8), senão monta o template determinístico de
  volume/tendência via nova function `get_volume_delta` (migration
  `20260725020000`, mesmo padrão de escopo por Narrativa de
  `get_sentiment_breakdown`). `narrative_text` deixa de ser sempre `null`.
- Achado durante a propagação destas 4 mudanças pelas 6 Edge Functions
  (Princípio técnico 5): um script de propagação com substituição de
  texto ingênua causou uma duplicação real (3 cópias de
  `fetchNarrativeText`) e uma chamada recursiva quebrada
  (`getPageEnvelopeWithCache` chamando a si mesma em vez de
  `assemblePageResponse` internamente) nas 6 Edge Functions — detectado
  e corrigido na mesma sessão reconstruindo os 6 arquivos a partir do
  arquivo canônico + cada handler original, antes de `npm run build`
  confirmar tudo limpo. Mencionado aqui como lembrete: qualquer alteração
  futura no arquivo canônico ainda precisa ser recopiada manualmente pras
  6 Edge Functions (não há ferramenta de propagação automática segura
  neste projeto).
Ver `aggregated-metrics/sql-aggregation.md`, `service-layer-aggregation.md`
e `ai-synthesis.md` para as specs atualizadas. `npx tsc --noEmit` e
`npm run build` confirmados limpos (18 rotas) — migrations não executadas
contra um banco real nesta sessão (sem acesso, mesma limitação recorrente
de toda sessão sem credenciais de deploy).

✅ **Ampliação de escopo 2026-07-25** (pedido do usuário, não numerado,
`communications`, mesma sessão): "o usuário poderá registrar uma
comunicação ou uma decisão. Comunicação deve ter os campos já
documentados e decisão deve ter apenas a data, um título, responsável,
detalhamento." `communications` ganhou `record_type` (`communication`\|
`decision`) — Decisão é um subconjunto estrito dos campos de Comunicação
(sem `communication_type_id`/`channel_detail`/`external_url`/
`bw_resource_id`, aplicado via CHECK constraint), mesma tabela/formulário/
tela/mecanismo de impacto antes/depois que Comunicação já tinha. `published_at`
renomeado para `occurred_at` (neutro entre os dois tipos). Observação
registrada (não uma pendência bloqueante): a sobreposição conceitual entre
"Decisão" e `cases` ficou maior do que quando o módulo só cobria
Comunicação — mantidos separados por ser um pedido específico do usuário,
não uma fusão de modelos assumida. Ver `communications/overview.md`
("Relação com `cases`"), `communications/data-model.md` e
`communications/communication-registration.md`.

✅ **Resolvidas 2026-07-25** (decisões #27 e #29, `communications`, mesma
sessão, dois pedidos do usuário): "1) tipo de comunicação pode ser uma
tabela que é atualizada com os tipos e a lógica do módulo pega dela. 2) o
vínculo será manual, no cadastro da comunicação o usuário seleciona uma
narrativa em um campo combo box." Decisão #27 (lista final de
`communication_type`) deixou de ser uma decisão de schema bloqueante —
virou tabela `communication_types` (`code`/`label`/`is_active`/`position`),
extensível por `INSERT`, nunca por `ALTER TYPE`; mesmo padrão de
extensibilidade já usado em `entity_tags`/`bw_categories.status`. Decisão
#29 (vínculo `communications` ↔ `mentions`) confirmada como manual,
definitiva — usuário cola o link/ID da mention, sem matching automático
planejado em nenhuma versão futura. Mesmo pedido também esclareceu a UX de
vínculo com a Narrativa (não numerada nesta tabela, não era uma decisão em
aberto): combobox com busca no formulário de cadastro, mais um botão "+
Registrar comunicação" reaproveitando o mesmo formulário a partir do
detalhe/modal de uma Narrativa (pré-preenchido e travado). Ver
`communications/overview.md`, `communications/data-model.md` e
`communications/communication-registration.md`, "Entrada rápida a partir
de uma Narrativa".

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

✅ **Resolvida 2026-07-14** (pedido do usuário, não numerada, a partir de
screenshot mostrando todo card de Narrativa preso no fallback "Resumo
automático ainda não disponível para esta Narrativa."): `narratives.description`
nunca teve nenhum produtor em nenhuma camada do produto desde
`20260707000000`, apesar de `narratives-exploration.md` já apontar o
candidato natural desde 2026-07-13. Fechado com `narrative-summary-composer`
(Edge Function nova, `pg_cron` a cada 30min, migration `20260804010000`) —
scores via `get_narratives_table` + eventos recentes do `event-radar` +
Comunicações/Decisões recentes (`communications`), texto livre via Claude
Haiku 4.5, escreve `description`/`description_generated_at`. Ver
`foundation/narratives.md`, "Resumo executivo (produtor)".

✅ **Resolvida 2026-07-14** (achado durante a implementação acima, não uma
pendência previamente registrada): regressão real e silenciosa em
`get_narratives_table` — a migration `20260802030000` (fix de sentimento
"Neutro predominante") tinha sido escrita a partir de uma cópia da versão
anterior ao boost de risco do `event-radar` (`20260802010000`, A2 da Fase
B), revertendo esse boost sem nenhum aviso (`create or replace` com a
mesma assinatura não alertou de nada). Corrigido na migration
`20260804000000`, reunindo as duas correções (sentimento + boost) na mesma
function. Ver `aggregated-metrics/sql-aggregation.md`, "Risco".

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
| 7 | `aggregated-metrics` | ✅ **Resolvido (2026-08-02, migration `20260802020000`)** — tabela `page_narrative_synthesis` criada exatamente com o schema de `ai-synthesis.md`, RLS com policy de SELECT/INSERT/UPDATE pra `authenticated` escopada por organização. Camada 1 (composição via Claude Haiku 4.5, disparada em background via `scheduleBackground`/`EdgeRuntime.waitUntil`) implementada em `aggregated-metrics-service.ts` e propagada às 7 Edge Functions `get-page-*`/`get-narrative-detail` | [aggregated-metrics/ai-synthesis.md](aggregated-metrics/ai-synthesis.md) |
| 8 | `aggregated-metrics` | ✅ **Resolvido (2026-08-02, migration `20260802010000`)** — `get_active_highlights` implementada (leitura pura de `feed_events`, escopada por `organization_id`/período/`filters.narratives`), `fetchHighlights` na service layer não retorna mais `[]` incondicionalmente. Os 10 de 10 blocos do envelope agora têm function SQL implementada | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md), [event-radar/fluxo-aggregated-metrics.md](event-radar/fluxo-aggregated-metrics.md) |
| 11 | `aggregated-metrics` | `authors[].risk_level` sempre `null` — diferente de `narratives` (que tem a fórmula completa "Scores de Narrativa"), nenhuma spec define como calcular risco por autor individual. `get_authors_ranking` retorna `null` de propósito até uma spec futura definir a fórmula | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md) |
| 16 | `intelligence-center` | ✅ **Fechado (2026-07-24)**: implementado como modal via intercepting route (`@modal/(.)narratives/[id]/page.tsx`), exatamente como `narratives-exploration.md` decidira em 2026-07-12 — ver decisão #1 (resolvida) acima | [intelligence-center/narratives-exploration.md](intelligence-center/narratives-exploration.md), "Fluxo principal" item 5 |
| 17 | `intelligence-center` | ✅ **Fechado por não-aplicabilidade (2026-07-21)**: drill-down "narrativas dentro da pauta" não existe mais como conceito — o escopo de Pautas Eleitorais foi corrigido (`intelligence-center/electoral-themes.md`) pra "Pauta = Subcategory da Category raiz 'Pautas'", e uma Subcategory já é folha (a Brandwatch não suporta um 3º nível). Não há "narrativas dentro de uma pauta" pra abrir. Histórico do gap original (quando "Pauta" ainda significava "qualquer Category raiz"): `get_theme_breakdown`/`BreakdownItem` nunca carregaram um `id` de Pauta pro clique escopar `get-page-themes` com `pauta_id` — deixou de ser relevante com a correção de escopo | [intelligence-center/electoral-themes.md](intelligence-center/electoral-themes.md) |
| 18 | `intelligence-center`/`platform-analysis` | 4 widgets de `/platforms` sem fonte de dado (nenhuma function SQL cobre): evolução do volume por plataforma ao longo do tempo, narrativas dominantes especificamente por plataforma, velocidade de propagação por plataforma (variação % entre períodos por `page_type`), conteúdos de destaque (cards de mentions individuais) — todos renderizados como `<EmptyState />` explicando o motivo, não omitidos silenciosamente. ✅ **2026-07-13**: mais 2 gaps do mesmo tipo identificados na paridade com o protótipo e também deixados como `<EmptyState />` honesto (não fabricados): "Engajamento médio por publicação" e "Autores únicos por plataforma" — o dado (`unique_authors`/`engagement_score`) já existe em `bw_query_metrics_daily_by_platform`, mas `BreakdownItem` só expõe `label`/`value`/`pct`, sem esses 2 campos; precisaria de um novo shape de breakdown ou campos extras. O widget "Sentimento por plataforma" que existia antes em `/platforms` foi removido (duplicava o mesmo widget da página `/sentiment`) e substituído por "Participação por plataforma" (barras de `pct`, sem score de sentimento), igual ao protótipo original | [intelligence-center/platform-analysis.md](platform-analysis.md) |
| 19 | `intelligence-center`/`sentiment-analysis` | ✅ **Metade resolvida (2026-07-17)**: "Sentimento por Narrativa" agora tem function+bloco (`get_narrative_sentiment_breakdown`, breakdown `type = 'narrative'`) — o dado (`narrative_metrics.sentiment_*`) já existia, só faltava o wiring. Continua em aberto só "Menções que mais influenciaram o sentimento" (lista de mentions individuais, sem bloco correspondente no envelope) | [intelligence-center/sentiment-analysis.md](sentiment-analysis.md), [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md) |
| 20 | `intelligence-center`/`narratives-exploration` | Detalhe de Narrativa: "Menções relevantes" e "Ações e decisões" (`cases`) ficam `<EmptyState />` — a primeira por falta de bloco no envelope (nenhum dos 8 blocos padrão cobre "lista de mentions em destaque"), a segunda porque a tabela `cases` (`intelligence-center/data-model.md`) ainda não tem migration — spec já previa esse estado vazio explicitamente ("Nenhuma ação registrada ainda") enquanto `cases` não existir | [intelligence-center/narratives-exploration.md](narratives-exploration.md), "Ações e decisões" |
| 22 | `intelligence-center`/`aggregated-metrics` | Card "Share of Voice por Query Group" da Visão Geral nunca foi construído — `get_metrics_cards` só retorna os 5 KPIs de `bw_query_metrics_daily` (`total_mentions`/`sentiment_*`/`reach_estimate`/`engagement_score`/`unique_authors`), sem function SQL nem bloco de envelope para SOV agregado por Query Group. Achado ao revisar `executive-overview.md` contra o código em 2026-07-16 | [intelligence-center/executive-overview.md](intelligence-center/executive-overview.md), "Cards de topo" |
| 23 | `foundation` | `bw_query_top_authors.sentiment_positive/neutral/negative` (e o mesmo em `bw_query_top_tweeters`) — mapeamento de `d.sentiment` da resposta de `data/volume/topauthors/queries` **nunca confirmado** contra a documentação real do endpoint (diferente de todo campo vizinho na mesma tabela, que tem nota de confirmação explícita). Risco real de ser sempre `0/0/0` em produção sem erro. Achado numa auditoria de sentimento por autor (2026-07-17) — `aggregated-metrics.get_authors_ranking` foi corrigida pra não ler mais estas colunas (usa `bw_query_author_topics` em vez disso), mas as colunas em si continuam sem confirmação/uso — revisar contra logs reais antes de reativar | [foundation/data-model.md](foundation/data-model.md), "bw_query_top_authors" |
| 24 | `aggregated-metrics` | `get_term_signals` mistura todo `topic_type` (`words`/`phrases`/`hashtags`/`entities`/`people`/`places`/`organisations`) num só ranking de "drivers" — nenhuma spec pediu filtrar só `phrases` (não é um gap de verdade), mas registrado caso o produto queira restringir no futuro | [intelligence-center/sentiment-analysis.md](sentiment-analysis.md) |
| 25 | `foundation`/`aggregated-metrics` | ✅ **Resolvida em duas partes (2026-07-25)**, mesmo dia. **Parte 1**: causa raiz real encontrada, diferente das duas hipóteses já descartadas em 2026-07-20/21 (fórmula de fallback diluída, chamadas de `netSentiment` starved pelo orçamento). `get_narratives_table.sentiment_label`/`net_sentiment` vinham de `latest_day` — snapshot de UM ÚNICO DIA — enquanto `sentiment_positive_pct`/etc. vinham de `period_agg`, somado sobre TODO o período: duas janelas de tempo diferentes na mesma linha. Corrigido na migration `20260725000000` (média ponderada de `net_sentiment` sobre a mesma janela de `period_agg`, com fallback local). **Parte 2**: usuário reportou de novo, screenshot diferente ("Economia": neg 42,5% predominante, borda/rótulo "Neutro") — a correção da Parte 1 ainda preferia o `net_sentiment` **oficial** da Brandwatch quando sincronizado, mas esse score vem de um endpoint diferente e independente (`data/netSentiment/...`) de `data/volume/sentiment/days` (origem de `sentiment_positive`/`neutral`/`negative`), sem garantia de reconciliar entre si. Corrigido definitivamente na migration `20260725060000`: `net_sentiment`/`sentiment_label` passam a vir **sempre** do cálculo local sobre as mesmas somas usadas por `sentiment_positive_pct`/etc. — nunca mais do score oficial da Brandwatch — garantindo por construção que rótulo/borda nunca discordem da barra pos/neu/neg do mesmo card | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md), "Sentimento (derivado localmente das proporções, não repassado direto de um score externo)" |
| 26 | `aggregated-metrics`/`intelligence-center` | ✅ **Fechado (2026-07-24)**: o rename `velocity_score`/`velocity_label` → `trend_score`/`trend_label` que tinha ficado incompleto (envelope.ts e a migration editados, consumidores não) foi terminado nesta sessão como parte da troca Velocidade→Tendência pedida pelo usuário (ver decisão resolvida acima) — todos os consumidores (`narratives/page.tsx`, `score-badges.tsx`, `narratives-table.tsx`, `narrative-detail-content.tsx`, `aggregated-metrics-service.ts`, as 6 Edge Functions `get-page-*`/`get-narrative-detail`) atualizados em conjunto. `npm run build` deve passar agora — reconfirmar antes do próximo deploy | `packages/shared-types/src/envelope.ts`, `app/(intelligence-center)/(analytics)/narratives/page.tsx` |
| 33 | `event-radar` | ✅ **1.1-1.4/1.6 implementados (2026-07-27 a 2026-07-31)**, `data-model.md` completo (2026-08-01, migration `20260801000000`), Fase B de `fluxo-aggregated-metrics.md` implementada (2026-08-02, gaps #7/#8) — `aggregated-metrics-integration.md` (A1/A2/A3) não segue mais intocado. Gap real restante: `schema-integration.md` continua `rascunho` porque **nenhuma UI existe** pra renderizar um card de `feed_events` nem pra dar feedback nele (`get_active_highlights` já existe, deixou de ser o bloqueio) — a UI dedicada é o widget "Radar de Eventos" (gap #35), spec pronta, sem código ainda | [event-radar/overview.md](event-radar/overview.md), [event-radar/schema-integration.md](event-radar/schema-integration.md) |
| 34 | `aggregated-metrics` | ✅ **Causa raiz encontrada e corrigida (2026-07-14)** — o gap tinha ficado registrado como reaberto ("`page_cache` desabilitado, bug de `/narratives` ainda não resolvido"), mas a causa real não era `page_cache` (nunca foi — desabilitá-lo não corrigiu nada, confirmado pelo usuário). Causa real: `get_narratives_table` existia como **dois overloads conflitantes** no banco — 6 parâmetros (recriado por `20260726020000` sem `drop function` prévio) e 7 parâmetros com `p_reference_at` (`20260726010000`, que tinha dropado corretamente o de 6 parâmetros antes de recriar, mas a migration seguinte na mesma sessão recriou-o de novo por engano). Toda chamada via PostgREST/`supabase.rpc(...)` (get-page-overview/get-page-narratives/get-narrative-detail — todas passam exatamente 6 argumentos nomeados, nunca `p_reference_at`) ficava sujeita à resolução de overload do PostgREST, que pode falhar a escolher um único candidato entre dois `get_narratives_table` do mesmo nome — erro nunca visível ao usuário, porque `fetchNarratives`/`fetchNarrativeSummary` capturam qualquer exceção da RPC e devolvem `[]`/`null` silenciosamente. Corrigido na migration `20260731040000`: dropa os dois overloads antigos e recria UM ÚNICO `get_narratives_table` de 7 parâmetros, reunindo as duas metades que tinham divergido (`category_label` + sentimento "proportion only" de `20260726020000`, `p_reference_at` na Tendência de `20260726010000` — o overload de 7 parâmetros tinha ficado sem `category_label` e sem o fix de sentimento, uma regressão real que só foi percebida agora). `page_cache` continua desabilitado (nunca foi reativado, decisão do usuário de retomar depois, ver `edge-functions-per-page.md`) — desabilitá-lo não era a causa, mas também não fazia mal manter assim enquanto se investigava | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md), [aggregated-metrics/edge-functions-per-page.md](aggregated-metrics/edge-functions-per-page.md) |
| 35 | `event-radar` | ✅ **Resolvido (2026-08-02)** — [frontend-highlights-feed.md](event-radar/frontend-highlights-feed.md) implementado: widget "Radar de Eventos" na Visão Geral (`RecentEventsPanel`), últimas 72h fixas, feedback do analista por card. As 3 pendências registradas foram fechadas: (1) `get_recent_highlights` implementada (migration `20260802040000`); (2) decisão tomada a favor de RPC direta do cliente, sem Edge Function; (3) confirmado que não bloqueava nada — o widget usa sua própria forma de resposta, não o tipo `Highlight` do envelope padrão | [event-radar/frontend-highlights-feed.md](event-radar/frontend-highlights-feed.md) |
| 36 | `finops` | `AI_MODEL_PRICING` (duplicada em `event-radar-agent-orchestrator/index.ts` e `aggregated-metrics-service.ts`) só tem entrada pra `claude-haiku-4-5` — se um ponto de chamada futuro usar outro modelo sem atualizar essa constante nos dois lugares, `recordAiUsage` grava `cost_usd = 0` silenciosamente (loga um erro, mas não bloqueia nem alerta no painel) — o painel de FinOps subestimaria o gasto real sem avisar visualmente. Nenhum spec pede uma tabela de preços versionada ainda (ver `finops/overview.md`, "Fora de escopo") — registrado aqui pra ser o primeiro lugar a checar se o gasto reportado parecer baixo demais depois de trocar de modelo em qualquer ponto de chamada de IA | [finops/data-model.md](finops/data-model.md) |
| 37 | `entities`/`intelligence-center` | Entity cadastrada manualmente ("Revista Fórum") reportada mostrando `ideologia = "Direita"` na UI apesar do usuário ter setado `esquerda` — auditoria de código completa (2026-08-09, `entity_match`/`ideologyLabel`/`ideologyBadgeClass`/`tailwind.config.ts`) não encontrou nenhum bug (todo mapeamento é por chave de dicionário direta, cores conferem com `IDEOLOGY_HEX`). Sem acesso ao banco real neste ambiente (RLS de `entities` exige `auth.role() = 'authenticated'`, a chave publicável sem sessão de login sempre volta vazia), não foi possível confirmar a causa. Hipótese mais plausível, já registrada como "Limitação aceita" em `entities/author-linking.md`: `get_authors_ranking`'s `entity_match` casa por `lower(trim(username))` **sem** filtrar por `platform` — se duas Entities diferentes têm uma conta com o mesmo texto de username em plataformas diferentes, a mais antiga (`order by ... created_at asc`) vence, mesmo sendo a errada. Próximo passo: usuário rodar `select id, name, ideologia from entities where name ilike '%fórum%' or name ilike '%forum%'` no SQL Editor do Supabase pra confirmar se há uma segunda Entity duplicada com esse handle (fix de dado) ou se o valor salvo realmente diverge do que o usuário pretendia (erro de digitação, também fix de dado, não de código) | [entities/author-linking.md](entities/author-linking.md) |
| 35 | `aggregated-metrics` | ✅ **Resolvido (2026-07-14), migration `20260802030000`** (renomeada de `20260731050000` em 2026-08-02 — colidia com outro arquivo de migration não relacionado do mesmo timestamp, ver `CLAUDE.md`, "Colisão de timestamp entre migrations..."): follow-up do gap #34, mesma sessão — depois de `narratives` voltar a popular, usuário reportou (screenshot) que o rótulo/borda de sentimento do card ainda contradizia a própria barra pos/neu/neg do mesmo card ("Direita"/"Esquerda": Neutro era o balde predominante — 44,2%/47,7% — mas o rótulo mostrava "Negativo -20"/"Negativo -29"). Confirmado matematicamente que a fórmula `(positivo-negativo)/(positivo+negativo)*100` batia exatamente com os números — o bug era nunca checar se Neutro era o balde predominante antes de decidir o rótulo pelo skew entre as duas minorias (positivo/negativo). Terceiro bug distinto na mesma família dos dois já corrigidos em 2026-07-25 (janela de tempo divergente, depois duas fontes divergentes) — ver "Correção #3" em `sql-aggregation.md`. Corrigido: rótulo é sempre `'neutral'`/score `0` quando Neutro é `>=` positivo E `>=` negativo; só senão o skew decide, nas mesmas 7 faixas. `risk_inputs.sentiment_risk` herda a correção | [aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md), "Sentimento (derivado localmente das proporções, não repassado direto de um score externo)" |
| 38 | `aggregated-metrics` | `composeNarrativeSynthesisOnDemand` (botão "Analisar com IA", período personalizado) não escopa `fetchHighlights` por `pautaIds` pra `page === 'themes'` — mesma classe de bug já corrigida no caminho automático (`assemblePageResponse`, 2026-08-09) e no caminho de `sentiment` (`SENTIMENT_HIGHLIGHT_EVENT_TYPES`, 2026-07-14, ver gap resolvido acima e `CLAUDE.md`), só que este caminho manual continua sem escopo pra Pautas — clicar "Analisar com IA" num período personalizado em `/themes` ainda pode compor texto sobre highlights fora do escopo de Pautas Eleitorais. Exigiria uma chamada extra a `get_narratives_table(p_scope='pautas')` dentro de `composeNarrativeSynthesisOnDemand` (que hoje não busca `narratives` de jeito nenhum) — não implementado por não fazer parte do pedido que motivou o fix de `sentiment` | [aggregated-metrics/ai-synthesis.md](aggregated-metrics/ai-synthesis.md), [intelligence-center/electoral-themes.md](intelligence-center/electoral-themes.md) |

✅ Item #6 (`auth` — UI + Edge Functions) removido desta tabela: já estava
`implementado` desde 2026-07-13 (ver `CLAUDE.md`, "Módulo auth (Sprint
2)") — o tracker só não tinha sido atualizado depois do trabalho ser
concluído, mesmo tipo de defasagem já corrigida antes para itens de
`foundation`.

✅ **Item #31 resolvido (2026-07-25)**: `get_narratives_table` ganhou
`p_reference_at timestamptz default now()` (migration `20260726010000`),
consumido por `get_communication_impact`/`get_narrative_communication_timeline`
(módulo `communications`, agora `implementado`) para ancorar Momentum/
Tendência/Risco/Sentimento numa data histórica em vez de sempre "agora".
Aditivo, sem efeito nos consumidores existentes. Ver
`aggregated-metrics/sql-aggregation.md`, "Tendência", e
`communications/narrative-impact-tracking.md`.

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

| 37 | `foundation`/`aggregated-metrics` | "Detratores"/"Impulsionadores positivos" (Detalhe de Narrativa, `intelligence-center/narratives-exploration.md`, implementado 2026-07-14) só conseguem classificar autores que estão simultaneamente entre o top 10 por volume da **Query inteira** (`runAuthorEnrichmentStep`, `bw_query_author_topics`) e no ranking de autores da Narrativa aberta — não há enriquecimento de sentimento por autor específico por Narrativa, então pra muitas Narrativas uma ou ambas as listas ficam vazias. Alargar pra "top N por Narrativa" tem custo real de orçamento de chamadas Brandwatch (2 chamadas extras por autor enriquecido, `foundation/data-model.md` §5) — não decidido nesta sessão, registrado como gap de engenharia caso o produto queira cobertura melhor no futuro | [foundation/data-model.md](foundation/data-model.md), "bw_query_top_authors", [intelligence-center/narratives-exploration.md](intelligence-center/narratives-exploration.md), "Formação e propagação" |
| 36 | `communications`/infra | ⚠️ **Incidente reportado pelo usuário (2026-08-01), não reproduzido nesta sessão** — 503 "Service Unavailable / The server is temporarily busy, try again later!" ao salvar o formulário de Comunicação/Decisão (`create-communication`), persistente ("o servidor não voltou mais"). Código de `create-communication` revisado e está correto (já tem o fallback `SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_ANON_KEY` que corrigiu o mesmo sintoma em 2026-07-15) — o texto do erro não é gerado por nenhuma resposta deste projeto (todo erro do código é JSON em português), é a página genérica do gateway do Supabase Edge Functions. Duas hipóteses não descartadas, sem acesso a Dashboard/logs neste ambiente pra confirmar: (1) a função está crashando no boot por algum outro motivo; (2) o projeto Supabase como um todo está sob limite de recursos — plausível dado o número de `pg_cron` novos rodando a cada 15min adicionados nas últimas sessões (`bw-sync-heartbeat`, detecção do `event-radar`, `event-radar-agent-orchestrator` — este último ainda chama a API da Anthropic a cada ciclo), em cima do que já existia (`refresh_narrative_metrics_hourly`). Usuário optou por só documentar por enquanto — checar no Dashboard: banner de status do projeto, Edge Functions → create-communication → Logs, `select * from cron.job` | — |

## Referências

- [_architecture.md](_architecture.md) — status por módulo (o que já existe vs. planejado).
- [_index.md](_index.md) — "Sequência de implantação — Sprint 2", mapa de módulos.
