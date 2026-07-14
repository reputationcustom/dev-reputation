---
tipo: feature-spec
módulo: aggregated-metrics
funcionalidade: ai-synthesis
status: implementado
atualizado: 2026-07-14
---

# Síntese Narrativa da Página (`narrative_text`)

> ✅ **Recomposição acompanha o radar + janela reduzida pra 1h (2026-07-14,
> mesmo dia da mudança acima)** — pedido do usuário: "esse resumo
> executivo precisa acompanhar o radar, se aparecer algo novo no radar,
> refaz o resumo executivo. Além disso, atualiza automaticamente de hora
> em hora", esclarecido com um exemplo concreto: "gerou-se um novo evento
> no radar, mas o resumo executivo do radar... acaba ficando desatualizado."
> Duas mudanças, ambas em `fetchNarrativeText()`:
> 1. **`AI_SYNTHESIS_REFRESH_HOURS` default 3h → 1h** — mesma constante,
>    só o valor padrão muda (ainda configurável via secret). ⚠️ Se o
>    secret já estiver definido explicitamente em produção (`supabase
>    secrets set AI_SYNTHESIS_REFRESH_HOURS=3`, feito ao testar a mudança
>    anterior), ele **não** é sobrescrito por este novo default — é
>    preciso `supabase secrets set AI_SYNTHESIS_REFRESH_HOURS=1` (ou
>    `unset` pra herdar o novo default do código) pra isso valer de fato
>    em produção.
> 2. **Gatilho por evento novo, independente da janela de tempo** — nova
>    `highlightsNewerThan(highlights, generatedAt)`: se qualquer highlight
>    do array já buscado nesta mesma requisição (`fetchHighlights`, sem
>    chamada extra) tem `created_at` mais recente que
>    `page_narrative_synthesis.generated_at`, conta como "algo novo
>    apareceu no radar desde a última composição" e dispara recomposição
>    em background — mesmo que a janela de 1h ainda não tenha vencido.
>    `get_active_highlights` (migration `20260809040000`) ganhou
>    `created_at` (`feed_events.created_at`, já existia na tabela, nunca
>    exposto por esta function) — é o dado que faltava pra essa
>    comparação. `Highlight` (`@reputation/shared-types` + a cópia inline
>    em `aggregated-metrics-service.ts`, Princípio técnico 5) ganhou
>    `created_at: string`. O gate de "mesmo condições de sempre" continua
>    valendo por cima dos dois gatilhos: só dispara quando `is_final =
>    false` e o período não é `custom`.
>
> Sobre o "e as narrativas" do exemplo do usuário: o resumo executivo
> **por Narrativa** (`narratives.description`, produzido por
> `narrative-summary-composer` — ver `foundation/narratives.md`, "Resumo
> executivo (produtor)") é um mecanismo **diferente** deste arquivo, e já
> reage a eventos novos do radar desde que foi criado (2026-07-14/
> 2026-08-04) — `narrative_summary_due_ids()` já marca uma Narrativa como
> "devida" quando "surgiu um `feed_events` novo pra ela desde o último
> resumo" (uma das 4 condições, junto com nunca-gerado/7-dias/Comunicação
> nova), avaliado a cada 30min via `pg_cron`. Não alterado nesta sessão —
> se ainda parecer desatualizado na prática depois do deploy de ambas as
> mudanças, é um sintoma a investigar separadamente (ex: o cron não está
> rodando, ou o batch de 5/invocação não dá conta do volume), não a mesma
> causa corrigida aqui.

> ✅ **Recomposição periódica de período aberto — a cada 3h (2026-07-14)**
> — pedido do usuário: "na funcionalidade ai-synthesis.md os resumos não
> estão atualizando até o momento. a atualização das
> `page_narrative_synthesis`, vamos definir atualização a cada 3h."
> Confirmado que o relato procedia: desde que a Camada 1 foi implementada
> (2026-08-02), `fetchNarrativeText()` sempre devolvia uma linha já
> existente em `page_narrative_synthesis` **como está, pra sempre**, sem
> nenhum gatilho de recomposição — documentado à época como limitação
> conhecida ("Fluxo principal"/"Fluxos alternativos" abaixo, `_pending.md`
> #21), não um bug, mas na prática significava que qualquer período ainda
> aberto ("Semanal"/"Mensal" em andamento) ficava com o resumo executivo
> **congelado no texto da primeira composição**, por mais que os dados
> subjacentes (highlights novos, sentimento, volume) mudassem depois.
> Fechado com uma janela de frescor: nova constante
> `AI_SYNTHESIS_REFRESH_HOURS` (`aggregated-metrics-service.ts`,
> configurável via secret, default `3` — mesmo padrão de
> `BW_SYNC_INTERVAL_HOURS`) + `isNarrativeTextStale(generatedAt)`. Ao
> encontrar uma linha existente, `fetchNarrativeText()` continua
> devolvendo o texto já gravado **nesta mesma resposta** (nunca bloqueia a
> página esperando uma nova composição), mas agora também dispara uma
> recomposição em background (`scheduleBackground`, mesmo mecanismo
> fire-and-forget já usado pra "linha não existe") sempre que **todas**
> as condições valem: período ainda aberto (`is_final = false` —
> permanece nunca recomposto quando fechado, por definição), período não
> é `custom` (mesmo gate de sempre — um intervalo personalizado nunca
> dispara IA sozinho, só pelo botão "Analisar com IA"), e `generated_at`
> já tem 3h ou mais. Não resolve os dois gatilhos "empurrados" que a spec
> original previa (sync concluir um ciclo / botão "Atualizar dados" — nenhum
> dos dois existe no produto) — em vez disso, resolve o mesmo problema por
> um caminho mais simples e já usado em todo o resto do projeto: um
> intervalo fixo, puxado a cada carregamento de página (nunca um cron
> dedicado — `page_narrative_synthesis` só é gravada quando alguém
> realmente abre a página, então não há razão pra rodar isso em segundo
> plano sem ninguém olhando). Propagado (Princípio técnico 5) na cópia
> canônica e nas 8 Edge Functions deployadas que a replicam
> (`get-page-{overview,narratives,sentiment,platforms,themes,authors}`,
> `get-narrative-detail`, `compose-narrative-synthesis`). Sem migration —
> `generated_at` já existia na tabela desde sua criação, só não era lida
> por `fetchNarrativeText()` até agora.

> ✅ **Bug de escopo em `themes` corrigido (2026-08-09)** — pedido do
> usuário: "Insights [de Pautas Eleitorais] deve focar apenas no conteúdo
> de Pautas Eleitorais, reveja o envelope dessa página para saber se a IA
> está tratando corretamente." Achado real: `get_active_highlights`
> (Camada 1) e `get_volume_delta` (Camada 0) só sabem escopar por
> `filters.narratives` — nenhuma das duas tem noção de "página de Pautas".
> `themes` nunca setava esse filtro (só `get-narrative-detail` o faz, via
> `ctx.narrativeId`/`effectiveFilters`), então `narrative_text`/`highlights`
> nesta página sempre refletiram a **organização inteira**, nunca
> restritos ao conteúdo de Pautas Eleitorais — mesmo bug, nas duas
> camadas, já que ambas recebem o mesmo `highlights`/contexto escopado (ou
> não). Corrigido em `assemblePageResponse`: busca as Narrativas-Pauta
> primeiro (mesma `get_narratives_table(p_scope='pautas')` que já
> alimenta o bloco `narratives` desta página, reaproveitada — nunca uma
> segunda chamada) e usa os IDs pra popular `filters.narratives` só nas
> chamadas de `fetchHighlights`/`fetchNarrativeText` feitas para `themes`.
> Nenhuma outra página é afetada — o desvio de `context` pra
> `highlightsContext` só acontece quando `page === 'themes'`. Ver
> `intelligence-center/electoral-themes.md` e `CLAUDE.md` para o
> detalhamento completo.

> ✅ **Bug de escopo em `sentiment` corrigido (2026-07-14)** — mesma
> pergunta do usuário, agora pra `/sentiment`: "Insights de sentimento
> estão relacionado aos sentimentos? se não estiver corrija." Achado
> real, mas de uma dimensão diferente da de `themes` acima:
> `get_active_highlights` nunca teve NENHUM filtro por `event_type` — só
> `organization_id`/`period`/`filters.narratives`. "Insights" (e
> `narrative_text`/"Mudança de sentimento", que lê a mesma lista de
> highlights como contexto/gate) em `/sentiment` sempre mostraram eventos
> de qualquer tipo (`volume_spike`/`volume_drop`/`momentum_spike`
> inclusos), não só os 3 tipos que `event-radar` já classifica como sendo
> sobre sentimento (`sentiment_change`/`negative_sentiment_increase`/
> `negative_sentiment_spike`, ver `feedEventType()` em
> `event-radar-agent-orchestrator/index.ts`). Corrigido com
> `get_active_highlights(..., p_event_types text[] default null)`
> (migration `20260809100000`) + `SENTIMENT_HIGHLIGHT_EVENT_TYPES` em
> `assemblePageResponse`, mesmo mecanismo do fix de `themes` (desvio de
> `context`, aqui só `eventTypes` em vez de `filters.narratives`), aplicado
> também a `composeNarrativeSynthesisOnDemand` (botão "Analisar com IA").
> ⚠️ Gap conhecido, não fechado: esse mesmo botão continua sem escopar por
> `pautaIds` pra `themes` — só o caminho automático (`assemblePageResponse`)
> tem esse filtro hoje. Ver `intelligence-center/sentiment-analysis.md` e
> `CLAUDE.md` para o detalhamento completo.

> ✅ **Camada 0 implementada (2026-07-25, gap #27 de `_pending.md`,
> resolvido)** — `fetchNarrativeText()` (`aggregated-metrics-service.ts`):
> usa `summary`/`explanation` do highlight quando há exatamente 1; caso
> contrário monta o template determinístico "Sem eventos relevantes
> detectados no período. Volume {cresceu|caiu} de {delta_pct}% em relação
> ao período anterior." via nova function SQL `get_volume_delta` (migration
> `20260725020000`, escopada por `filters.narratives` como
> `get_sentiment_breakdown`). `narrative_text` deixa de ser sempre `null`.
> Achado anterior (2026-07-13, ainda relevante como histórico): o código
> chegou a ter um comentário afirmando que a Camada 0 "já cobria o texto
> determinístico" quando na verdade `narrative_text` era gravado `null`
> incondicionalmente — corrigido junto com a implementação real desta vez.
>
> ✅ **Camada 1 implementada (2026-08-02, event-radar/fluxo-aggregated-metrics.md
> "Fase B", A3, migrations `20260802010000`/`20260802020000`)** —
> `get_active_highlights` existe (bloco `highlights` já real, não mais
> sempre `[]`, ver `sql-aggregation.md`) e a tabela `page_narrative_synthesis`
> foi criada exatamente com o schema descrito em "Dados envolvidos" abaixo.
> `fetchNarrativeText()` foi dividida em `fetchLayer0NarrativeText()` (0/1
> highlight, lógica inalterada) e uma nova `fetchNarrativeText()` externa
> que implementa o "Fluxo principal" abaixo: 2+ highlights → busca
> `page_narrative_synthesis` pela chave exata; linha existente → devolve
> direto, nunca chama IA de novo; sem linha → fallback imediato é
> `fetchLayer0NarrativeText`, e a composição real (`composeLayer1NarrativeText`
> + `composeAndPersistLayer1`) roda em **background**, sem bloquear a
> resposta HTTP já enviada, via `scheduleBackground()` — um wrapper sobre
> `EdgeRuntime.waitUntil` (feature do runtime do Supabase Edge Functions)
> com fallback "dispara sem aguardar" quando esse global não está
> disponível (ex: execução local), escrito sem `declare const EdgeRuntime`
> pra não arriscar colidir com uma tipagem ambiente já fornecida pelo
> runtime Deno. Modelo: **Claude Haiku 4.5** (`claude-haiku-4-5`,
> configurável via secret `AI_SYNTHESIS_MODEL`) — mesma decisão de custo já
> tomada pra `event-radar-agent-orchestrator` (2026-07-31), reaplicada sem
> perguntar de novo ao usuário por ser a mesma pergunta/mesmo raciocínio já
> resolvido uma vez neste projeto: a tarefa da Camada 1 é ainda mais barata
> que a do orquestrador do radar ("não analisa dados, só reescreve/conecta
> texto que já existe"), então o mesmo modelo mais econômico se aplica com
> ainda mais razão. Tom da composição: instrução direta no prompt de
> sistema (ver "Dependências técnicas" abaixo — a skill `humanizer-pt-br`
> que esta spec citava não existe). `is_final` calculado via
> `period_end < hoje` em `America/Sao_Paulo`
> (`Intl.DateTimeFormat('en-CA', ...)`, formato `YYYY-MM-DD`, comparável
> como string com `period_end`). **Não implementado nesta rodada** (fora
> do que a "Fase B" pedia): os dois gatilhos de invalidação de um período
> **aberto** já com linha em `page_narrative_synthesis` (sync concluído/
> "Atualizar dados") — nenhum dos dois existe no produto ainda
> (`_pending.md` gap #21), então uma linha existente é sempre devolvida
> como está, nunca recomposta, mesmo num período aberto; documentado como
> comportamento atual, não um bug.

> ✅ **Revisão de coerência (2026-08-03)** — pedido do usuário: "verifique
> se a documentação de ai-synthesis está coerente e concisa com o restante
> que foi desenvolvido." Achados reais, corrigidos nesta revisão: (1) a
> seção "Camada 1" e o "Fluxo principal" abaixo ainda descreviam uma
> branch condicional em `is_final` (linha `is_final = false` dispararia
> recomposição assíncrona) que **nunca foi implementada** — o bloco acima
> (2026-08-02) já corrigia essa mesma afirmação, mas o corpo do spec não
> tinha sido atualizado em conjunto e continuava contradizendo o próprio
> blockquote; reescrito pra descrever só o comportamento real (linha
> existente é sempre devolvida como está, sem exceção). (2) `overview.md`
> (módulo pai) ainda listava `get_active_highlights`/Camada 1 como gaps
> pendentes — ambos implementados em 2026-08-02, corrigido junto. Achados
> menores, documentados inline nas seções correspondentes: o limite de 500
> caracteres da composição nunca estava escrito nesta spec (só existia no
> código); as páginas `narrative_detail`/`Plataformas` têm `narrative_text`
> sem `highlights` no próprio `PAGE_BLOCKS`, então nunca alcançam a Camada
> 1 (sempre Camada 0, sub-caso "0 highlights") — não documentado antes;
> `/reports` está entre as páginas cujo `PAGE_BLOCKS` habilita a Camada 1,
> mas `get-page-reports` ainda não existe (`/reports` é um `ComingSoonPage`
> sem backend) — na prática só 3 páginas alcançam a Camada 1 hoje
> (`Visão Geral`/`Sentimento`/`Pautas Eleitorais`), não 4.
>
> **Nada de código foi alterado** — a implementação já batia com o
> blockquote de 2026-08-02 acima; a incoerência era só entre partes
> diferentes do texto deste mesmo arquivo. Os dois gaps reais que
> permanecem (os 2 gatilhos de invalidação de período aberto, Camada 2)
> continuam deliberadamente não implementados: o primeiro é uma decisão já
> registrada e adiada em `_pending.md` #21 ("revisitar se isso passar a
> incomodar na prática"), e o segundo é opt-in por desenho (exige
> justificativa por página antes de ser construído, "As três camadas"
> abaixo) — nenhuma página registrou essa justificativa ainda, então não
> há nada a construir por enquanto.

> ✅ **Skill `humanizer-pt-br` instalada + tom padronizado nos 3 pontos de
> geração de texto por IA (2026-08-06)** — pedido do usuário: humanizar as
> respostas da IA em todo o produto, objetivas/claras/eficientes, sem
> textos longos, usando a skill `humanizer-pt-br`
> (`npx skills add https://github.com/mackswendhell/humanizer-pt-br --skill
> humanizer-pt-br`). Corrige a nota anterior deste arquivo (2026-08-02),
> que confirmava a ausência dessa skill no repositório — ela existe agora
> em `.agents/skills/humanizer-pt-br/SKILL.md`. Como a skill é um guia
> interativo de edição (recebe texto pronto e reescreve, não um trecho
> colável na API), seus padrões concretos (frases diretas, sem "gancho"
> dramático, sem vocabulário de IA, sem atribuição vaga, sem conclusão
> genérica) foram destilados numa instrução de tom compacta, duplicada
> (Princípio técnico 5) em `NARRATIVE_SYNTHESIS_SYSTEM_PROMPT`
> (`aggregated-metrics-service.ts`, Camada 1 — este arquivo),
> `event-radar-agent-orchestrator/index.ts`'s `SYSTEM_PROMPT` e
> `narrative-summary-composer/index.ts`'s `SYSTEM_PROMPT` (ver
> `foundation/narratives.md`, "Resumo executivo (produtor)") — os 3 únicos
> pontos do produto onde a IA gera texto lido pelo usuário. Ver
> "Dependências técnicas" abaixo pro detalhe completo da skill. Mesma
> sessão também estendeu `narrative_summary_build_payload` (não este
> arquivo — `foundation/narratives.md`) com `sample_mentions`, mentions
> reais da Narrativa como contexto qualitativo — não muda nada da Camada
> 0/1 descritas aqui, que continuam só reescrevendo `summary`/`explanation`
> de highlights já prontos, nunca mentions cruas.

> ✅ **Diferenciação diário/semanal/mensal + gatilho manual pra período
> personalizado (2026-07-14)** — pedido do usuário: "o resumo executivo
> gerado pela IA deve ter a diferenciação, diário, semanal e mensal para
> suportar a navegação do usuário. Em caso de período personalizado,
> vamos colocar um botão no frontend para possibilitar o usuário final
> chamar a IA para analisar caso ele queira." A diferenciação
> diário/semanal/mensal já existia por construção (cada modo do header
> produz `period.start`/`end` distintos, e a chave de
> `page_narrative_synthesis` inclui esses dois campos — trocar de aba no
> header naturalmente busca/gera uma composição própria por modo, nunca
> reaproveita a de outro). O que faltava era a segunda parte: até esta
> mudança, `fetchNarrativeText()` disparava a composição da Camada 1 em
> background pra **qualquer** período com 2+ highlights, inclusive um
> intervalo personalizado ainda sendo ajustado nos 2 campos de data do
> header — cada combinação nova digitada podia disparar uma chamada de IA
> descartada antes mesmo do usuário terminar de escolher o intervalo.
> Fechado com um novo campo opcional `period.mode` (espelha `PeriodMode`
> do header — `"daily" | "weekly" | "monthly" | "custom"`, ver
> `standard-json-envelope.md`): `fetchNarrativeText()` só chama
> `scheduleBackground(composeAndPersistLayer1(...))` quando
> `ctx.period.mode !== 'custom'` — pra período personalizado, a página
> carrega sempre com o fallback determinístico da Camada 0 (nunca chama
> IA sozinha), e uma nova Edge Function dedicada,
> `compose-narrative-synthesis`, expõe `composeNarrativeSynthesisOnDemand()`
> pro botão "Analisar período com IA" (`NarrativeTextPanel`, só visível
> quando `periodMode === "custom"`) — chamada explícita do usuário,
> síncrona (aguarda o resultado, ao contrário do disparo em background da
> Camada 1 automática), mesmo gate de 2+ highlights (com 0/1 a Camada 0 já
> é suficiente e determinística, chamar IA seria custo sem benefício) e
> mesma tabela/chave `page_narrative_synthesis` — depois de compor com
> sucesso, o frontend só rechama `usePageEnvelope`'s `retry()`, que agora
> encontra a linha recém-persistida na primeira tentativa. Uma linha já
> persistida (ex: um período personalizado já analisado antes) continua
> sendo devolvida direto pelo fluxo normal, mesmo em modo `custom` — só o
> disparo *automático* fica condicionado a `daily`/`weekly`/`monthly`.
> Nenhuma mudança de schema — reaproveita a `page_narrative_synthesis`
> existente por inteiro.

> ✅ **Camada 2 implementada — 3 seções reais + admin force-refresh
> (2026-07-14)** — pedido do usuário: preencher, via ai-synthesis, 3
> widgets que eram `EmptyState`/gap há sessões por não terem equivalente
> no radar — "Conteúdos de destaque" (`platforms`), "Comparação entre
> períodos" (`themes`) e uma visão geral sucinta de "Autores e
> Influenciadores" (`authors`); mais uma exigência geral: "permita que eu
> consiga executar a atualização do resumo executivo... por algo
> disponível na sessão do administrador."
>
> **Schema**: `page_narrative_synthesis` ganhou a coluna `section text not
> null default 'main'` (migration `20260809050000`) — generaliza a chave
> pra `(organization_id, page, section, period_start, period_end,
> filters_hash)`. `'main'` é o `narrative_text` genérico de sempre (Camada
> 0/1); as 3 seções novas usam valores próprios (`'featured_content'`,
> `'period_comparison'`, `'overview'`). Todo o código existente
> (`fetchNarrativeText`/`composeAndPersistLayer1`/
> `composeNarrativeSynthesisOnDemand`) foi atualizado pra filtrar/gravar
> `section = 'main'` **explicitamente** — sem isso, um `.maybeSingle()`
> encontraria 2+ linhas assim que a primeira seção nova existisse pra essa
> mesma `(page, period, filters_hash)`.
>
> **Mecanismo genérico** (`fetchSectionText`/`composeAndPersistSection`/
> `composeSectionText`, `aggregated-metrics-service.ts`) — mesma
> tabela/persistência/janela de frescor (`AI_SYNTHESIS_REFRESH_HOURS`,
> default 1h) já usada pela Camada 1, só sem o gatilho de "evento novo do
> radar" (essas 3 seções não dependem de `highlights`) e com
> `layer: 'layer_2'`. Cada seção tem seu próprio *system prompt* + função
> de payload (só dado já agregado, nunca mentions cruas) + fallback
> determinístico próprio (nunca uma tela vazia sem explicação):
> - **`platforms` / `featured_content`** ("Conteúdos de destaque") —
>   payload = breakdown de plataforma (top 5) + `term_signals` (top 8) já
>   buscados pela página. Justificativa da Camada 2: não há
>   `feed_events` equivalente a "quais plataformas/termos dominam este
>   período" — é uma leitura composta, não um evento pontual.
> - **`themes` / `period_comparison`** ("Comparação entre períodos") —
>   payload = `get_theme_breakdown` (já usado por "Share of Voice e
>   sentimento por pauta") chamado uma 2ª vez pro período imediatamente
>   anterior (mesma duração, `previousPeriodRange()` — aritmética de data
>   pura em JS, sem chamada à Brandwatch). Justificativa: o radar detecta
>   picos/quedas pontuais, não "como o quadro geral mudou" — e não cobre
>   todas as Pautas de uma vez sem virar N eventos artificiais.
> - **`authors` / `overview`** (dentro de "Conteúdo em destaque (Top
>   Sites, X Themes)") — payload = top 5 autores por alcance + top 5 sites
>   + top 5 hashtags, já buscados pela página. Justificativa: perfil
>   composto de quem são os autores/conteúdos em destaque, não um evento.
>
> **Frontend**: novo `components/ui/expandable-text.tsx`
> (`ExpandableText`) — pedido do usuário, nos 5 widgets afetados: "se a
> descrição for maior que cabe no frame, inclua a opção mostrar mais e
> mostrar menos" (o texto literal do pedido dizia "menor", tratado como
> imprecisão de digitação — o padrão padrão de UX, e o único que faz
> sentido, é mostrar o toggle quando o texto **transborda** o clamp, nunca
> quando já cabe). Mede `scrollHeight > clientHeight` do próprio parágrafo
> clampado (`line-clamp` via `-webkit-line-clamp`) — só mostra
> "Mostrar mais" quando o texto de fato transborda 4 linhas; um texto
> curto nunca ganha o toggle. Usado por `NarrativeTextPanel` (Camada 0/1,
> seção `'main'`) e pelos 3 widgets de Camada 2 acima.
>
> **Página `narratives` ganhou "Resumo executivo da página"** — antes
> desta sessão, `/narratives` era a única das 5 páginas de análise sem
> nenhuma noção de `highlights`/`narrative_text` (`PAGE_BLOCKS.narratives`
> não incluía nenhum dos dois). Fechado adicionando os 2 blocos — mesmo
> mecanismo de sempre (Camada 0/1, seção `'main'`), nenhuma seção nova.
>
> **Admin force-refresh** (pedido do usuário: "algo disponível na sessão
> do administrador") — 2 mecanismos, cada um cobrindo uma parte diferente
> do pedido:
> 1. `NarrativeTextPanel`'s botão (antes só visível em período `custom`)
>    agora também aparece pra `is_admin` em qualquer período
>    (`daily`/`weekly`/`monthly`) — reaproveita a mesma Edge Function já
>    existente (`compose-narrative-synthesis`, síncrona, sempre recompõe
>    quando chamada), só muda a visibilidade do botão no frontend. Cobre
>    o `narrative_text`/seção `'main'` de qualquer página.
> 2. Nova Edge Function admin-only, **`admin-refresh-narrative-summaries`**
>    (mesmo padrão de auth de todo `admin-*`: Bearer JWT →
>    `supabaseAdmin.auth.getUser(token)` → checar `user_profiles.is_admin`)
>    — força `narratives.description` (o resumo **por Narrativa**,
>    produzido por `narrative-summary-composer`, ver
>    `foundation/narratives.md`) a ser regerado AGORA pra toda Narrativa
>    ativa de uma organização, até `MAX_BATCH_SIZE = 50` por chamada
>    (admin clica de novo se sobrar mais — mesmo padrão de "continuar em
>    lotes" já aceito em outras partes do produto). `narrative_summary_due_ids()`
>    ganhou `p_organization_id`/`p_force` (migration `20260809060000`, drop
>    function — mudança de aridade) — com `p_force = true`, ignora as 4
>    condições de staleness de sempre e devolve toda Narrativa ativa da
>    organização. Botão "Atualizar resumos executivos das Narrativas" em
>    `/narratives`, admin-only. **Deliberadamente não exposto** via
>    `narrative-summary-composer` em si (que só o `pg_cron` chama,
>    `verify_jwt = false`, sem CORS/auth) — aceitar um `organization_id`
>    arbitrário nessa function sem autenticação seria um vetor de
>    "gaste dinheiro de IA da vítima" pra qualquer um que soubesse a URL.
>
> Nenhuma mudança nas 2 seções pré-existentes documentadas acima
> (recomposição por tempo/por evento novo do radar) — os 2 gatilhos
> continuam valendo exatamente como descrito, só pra seção `'main'`.

> ✅ **Camada 2 — teto de tamanho aumentado (2026-08-09)**, pedido do
> usuário: "Mostre o conteúdo completo do Conteúdo em destaque (Top
> Sites, X Themes), o texto está truncado." O texto visível terminava em
> "…" sem nenhum botão "Mostrar mais" — não era um problema de
> `ExpandableText`/clamp (que só corta visualmente e sempre oferece o
> toggle quando o texto excede 4 linhas), era o próprio texto composto
> por IA sendo cortado no backend: `composeSectionText()` (as 3 seções
> acima) tinha `max_tokens: 300` + `truncateAtSentence(text, 400)`, bem
> mais apertado que o `narrative_text` principal (Camada 0/1, `max_tokens:
> 400` + `truncateAtSentence(text, 500)`). Aumentado pra `max_tokens: 600`
> + `truncateAtSentence(text, 900)`, e os 3 `SYSTEM_PROMPT`s
> correspondentes tiveram sua instrução de tamanho alinhada ("2-3/2-4
> frases, até 400 caracteres" → "3-6 frases, até 900 caracteres") — sem
> isso, o modelo continuaria mirando 400 caracteres na própria geração,
> tornando o novo teto de truncamento inútil na prática. Um texto já
> persistido antes deste fix continua truncado até ser recomposto
> naturalmente (janela de `AI_SYNTHESIS_REFRESH_HOURS` ou linha ainda
> inexistente).

## Objetivo

Preencher `narrative_text` do envelope com o texto explicativo que aparece nas páginas (ex: "O
volume de menções cresceu 18% no período. O principal pico ocorreu na terça-feira..."), **sem
duplicar a análise que o módulo `event-radar` já faz por evento**. Este spec substitui a
abordagem anterior (que previa uma chamada de IA nova por página) por uma abordagem em camadas,
sempre preferindo reaproveitar texto já gerado antes de pagar por uma nova chamada.

## Regra fundamental

> ⚠️ Este módulo NUNCA deve chamar a IA para "explicar a tendência" do zero. Essa análise
> (pico, queda, mudança de sentimento, causa provável) já é feita pelo orquestrador do
> `event-radar`, uma vez por evento, deduplicada e com cap diário. `aggregated-metrics`
> apenas lê e, no máximo, costura o que o radar já publicou.

## As três camadas (nesta ordem de preferência)

### Camada 0 — Sem IA (padrão para a maioria das páginas)

Quando a página tem exatamente 0 ou 1 highlight relevante no escopo, `narrative_text` é montado
por template determinístico, sem chamar IA. Exemplo de template:

- 0 highlights: `"Sem eventos relevantes detectados no período. Volume {trend_direction} de
  {delta_pct}% em relação ao período anterior."`
- 1 highlight: usa diretamente o `summary`/`explanation` daquele highlight, sem modificação.

### Camada 1 — Composição em lote, armazenada em banco (páginas com múltiplos highlights)

Quando a página tem 2+ highlights relevantes no escopo, o sistema faz **uma única chamada de
composição** que recebe os `summary`/`explanation` já existentes desses highlights (não os dados
brutos de novo) e devolve um parágrafo coeso amarrando os eventos. Hoje isso só é alcançável em
`Visão Geral`, `Sentimento` e `Pautas Eleitorais` — as páginas cujo `PAGE_BLOCKS` inclui
`highlights` **e** `narrative_text` juntos **e** já têm uma Edge Function `get-page-*` deployada.
`PAGE_BLOCKS.reports` também combina os dois blocos, mas `get-page-reports` ainda não existe
(`/reports` é hoje um `ComingSoonPage` sem backend, Sprint 4/`executive-reports`) — a Camada 1
está pronta pra essa página, só inalcançável até o backend existir. `Alertas` tem `highlights` mas
não `narrative_text`, então nunca aciona esta camada mesmo quando `/alerts` ganhar backend.
⚠️ **`narrative_detail` e `Plataformas`** têm `narrative_text` **sem** `highlights` no próprio
`PAGE_BLOCKS` — `highlights` nem é buscado pra elas, então nessas duas páginas `narrative_text` é
sempre resolvido pela Camada 0, sub-caso "0 highlights" (nunca "1 highlight", que depende da
página ter buscado a lista de destaques em primeiro lugar) — nunca chegam à Camada 1.

Esta chamada:

- NÃO analisa dados — só reescreve/conecta textos que já existem.
- ✅ **Limite de 500 caracteres no texto final** — instruído no próprio prompt de sistema
  (`NARRATIVE_SYNTHESIS_SYSTEM_PROMPT`) e reforçado no código com `.slice(0, 500)` como garantia
  adicional (diferente de `event-radar-agent-orchestrator`, que usa saída forçada via JSON
  Schema — aqui é texto livre, então o corte no código é o que garante o limite de fato).
- ✅ **Resolvido (2026-07-13)**: roda **sempre de forma assíncrona** (não mais uma
  recomendação, é a decisão final) — a página carrega com `narrative_text: null` ou com o texto
  da Camada 0 como fallback imediato, e atualiza quando a composição terminar.
- ✅ **Armazenamento persistente por período (2026-07-13)**, pedido do usuário: "deve ser
  assíncrona e armazenada em banco de acordo com o período para que não haja necessidade de
  pesquisar novamente utilizando a IA". Diferente de um cache com TTL (que expiraria e geraria
  uma chamada de IA nova mesmo pra um período **fechado**, que por definição não muda mais), a
  composição é gravada em `page_narrative_synthesis` (ver "Dados envolvidos" abaixo), chave
  `(organization_id, page, period_start, period_end, filters_hash)`:
  - Período **fechado** (`period_end < hoje`, em `America/Sao_Paulo`): uma vez gerado, o texto é
    **permanente** — nunca mais chama IA pra essa combinação exata, mesmo que o cache do
    envelope (TTL 5min, hoje desabilitado — ver `edge-functions-per-page.md`) expire e recarregue
    os blocos numéricos. Isso é o que evita "pesquisar de novo usando IA" pra um período que já
    passou.
  - Período **aberto** (`period_end >= hoje`, ex: "últimos 7 dias" ainda em andamento): a
    intenção original era permitir regeneração pelos mesmos gatilhos que invalidariam o cache do
    envelope (sync da Brandwatch concluiu um ciclo, ou usuário clicou "Atualizar dados") — nenhum
    dos dois existe no produto hoje, e não é mais o caminho escolhido pra este gap (ver abaixo).
    ✅ **Resolvido por dois gatilhos mais simples que o produto já tem (2026-07-14, ajustado no
    mesmo dia)**: em vez de esperar pelos 2 gatilhos "empurrados" que o produto não tem,
    `fetchNarrativeText()` recompõe quando **qualquer um** dos dois vale:
    1. **Tempo** — `AI_SYNTHESIS_REFRESH_HOURS` (configurável, default **1h**) já passou desde
       `generated_at`, puxado no próximo carregamento de página que encontrar a linha já vencida
       (nunca um cron dedicado).
    2. **Radar** — algum highlight já buscado nesta mesma requisição
       (`get_active_highlights`/`feed_events`) tem `created_at` mais recente que `generated_at`
       (`highlightsNewerThan()`) — "algo novo apareceu no radar" recompõe mesmo que a janela de
       tempo ainda não tenha vencido.

    Uma linha de período **fechado** continua sendo a única verdadeiramente permanente. `is_final`
    continua sendo gravado corretamente (`period_end < hoje` no momento da geração) e agora tem um
    consumidor real: só uma linha com `is_final = false` é candidata a recompor, por qualquer um
    dos dois gatilhos.

### Camada 2 — Nova análise via IA (exceção, precisa de justificativa)

Só existe se um bloco específico não tiver equivalente no radar (por exemplo, uma leitura pura
de `breakdowns`/`trends` sem nenhum evento associado, mas que ainda assim precise de
comentário qualitativo). Antes de implementar a Camada 2 para qualquer página, o Claude Code
deve registrar no spec da página por que a Camada 0 ou 1 não foram suficientes — mesma regra de
"justificar chamada extra de IA" que já vale para o `event-radar`.

✅ **Implementada (2026-07-14)** — 3 seções reais, cada uma numa página específica, nenhuma
compartilhada entre páginas. Diferente da Camada 1 (`narrative_text`, sempre a seção `'main'` de
`page_narrative_synthesis`), cada seção da Camada 2 usa seu próprio valor de `section` — mesma
tabela, mesma janela de frescor (`AI_SYNTHESIS_REFRESH_HOURS`), mesmo mecanismo
persistência/staleness (`fetchSectionText`/`composeAndPersistSection` em
`aggregated-metrics-service.ts`), só sem o gatilho de "evento novo do radar" (essas seções não
dependem de `highlights`, só do tempo). Ver o blockquote de topo deste arquivo pro detalhamento
completo de cada seção (`platforms:featured_content`, `themes:period_comparison`,
`authors:overview`) e das páginas correspondentes (`intelligence-center/platform-analysis.md`,
`electoral-themes.md`, `authors-and-influencers.md`) pra justificativa por página.

## Fluxo principal

1. A Edge Function da página já retornou `highlights` (leitura de `feed_events`, ver
   `sql-aggregation.md`).
2. O sistema conta quantos highlights estão no escopo da página:
   - 0 ou 1 → Camada 0, monta `narrative_text` na hora, sem IA, sem persistência (é
     determinístico, custa nada recalcular a cada vez).
   - 2+ → Camada 1: busca `page_narrative_synthesis` pela chave exata
     `(organization_id, page, period_start, period_end, filters_hash)`.
     - Linha existe → retorna o texto armazenado direto **nesta mesma resposta, sem esperar por
       IA nenhuma**. ✅ **2026-07-14**: se `is_final = false` (período ainda aberto), o período não
       é `custom`, e (`generated_at` já tem `AI_SYNTHESIS_REFRESH_HOURS` — default 1h — de idade
       **OU** algum highlight tem `created_at` mais recente que `generated_at`, "algo novo no
       radar"), também dispara uma recomposição em background pra essa mesma chave (mesmo
       mecanismo fire-and-forget do próximo item) — a resposta atual usa o texto antigo, a próxima
       já encontra o novo. `is_final = true` nunca recompõe (permanente por definição); `custom`
       nunca dispara IA sozinho (só pelo botão "Analisar com IA").
     - Linha não existe → fallback imediato é a Camada 0 (enquanto a composição não termina),
       dispara a composição assíncrona em background (`scheduleBackground`), grava o resultado
       ao terminar (só em caso de sucesso — ver "Fluxos alternativos e erros").
3. Ao gravar, `is_final` é calculado como `period_end < current_date` (timezone
   `America/Sao_Paulo`, mesmo padrão do resto do produto) — período fechado vira permanente.
4. `narrative_text` é copiado para o envelope cacheado (mesmo TTL de sempre) a partir do que
   está em `page_narrative_synthesis` — o envelope nunca é a fonte, só um espelho de leitura
   rápida.

## Fluxos alternativos e erros

| Situação                                          | Comportamento esperado                                         |
|-----------------------------------------------------|--------------------------------------------------------------------|
| Chamada de composição (Camada 1) falha              | `narrative_text` permanece com o fallback da Camada 0, nunca `null` sem explicação; nada é gravado em `page_narrative_synthesis` (só grava em caso de sucesso) — a linha antiga (se houver) continua servindo até uma recomposição bem-sucedida |
| Highlights mudam pra um período **aberto** já com linha em `page_narrative_synthesis` | ✅ **Recompõe por tempo OU por evento novo (2026-07-14)** — a próxima página carregada depois de `AI_SYNTHESIS_REFRESH_HOURS` (default 1h) **ou** que encontre um highlight com `created_at` mais recente que `generated_at` ("algo novo no radar") dispara uma recomposição em background (não bloqueia a resposta atual, que ainda usa o texto antigo); período `custom` fica de fora (só via botão "Analisar com IA") |
| Highlights mudam pra um período **fechado** já com `is_final = true` | Nunca regenera — período fechado é permanente por definição, mesmo que dado novo chegasse atrasado (caso raro, mesma aceitação de lag já usada em outras partes do produto) |
| Página sem highlights e sem dado suficiente (ex: organização nova) | Template da Camada 0 deve indicar claramente ausência de dados, nunca inventar tendência |

## Regras de negócio

- A IA nunca deve receber `ui_meta`, nem os blocos numéricos brutos (`metrics`, `breakdowns`,
  `trends`) na Camada 1 — só os textos (`summary`/`explanation`) dos highlights envolvidos. Isso
  é o que torna a chamada barata: ela compõe texto, não analisa números.
- Nenhuma página deve gerar uma chamada de IA por carregamento — Camadas 1/2 só chamam IA quando
  não existe linha aproveitável em `page_narrative_synthesis` pra aquela chave exata, ou (✅
  2026-07-14) quando a linha existente é de período aberto e (já passou de
  `AI_SYNTHESIS_REFRESH_HOURS`, default 1h, desde `generated_at` **ou** um highlight novo apareceu
  no radar desde então — ver "Fluxo principal"). Isso não
  é um TTL de cache genérico expirando sozinho (o `page_cache` de `edge-functions-per-page.md`
  continua um mecanismo independente, hoje desabilitado) — é uma janela de frescor específica
  desta tabela, só avaliada quando alguém de fato carrega a página, nunca por um cron dedicado.
- `narrative_text` deve sempre citar apenas o que está nos highlights recebidos — proibido
  inventar causa, número ou correlação que não veio do radar.

## Dados envolvidos

- **Lê**: `highlights` já presentes no envelope (originados de `feed_events`);
  `page_narrative_synthesis` (ver abaixo) pra checar se já existe composição pra essa chave
  antes de chamar IA.
- **Escreve**: `page_narrative_synthesis` (INSERT/UPDATE) — fonte de verdade da Camada 1/2;
  `narrative_text` no envelope cacheado é só uma cópia de leitura, nunca escrito direto.

### Tabela `page_narrative_synthesis` (nova, deste módulo)

> ✅ **Implementada (2026-08-02, migration `20260802020000`)** — schema
> idêntico ao descrito abaixo, `filters_hash` reaproveita a mesma função de
> hash já usada por `cacheFingerprint()` (`page_cache`, desabilitado — ver
> "Dependências técnicas" acima, são mecanismos independentes que só
> compartilham a lógica de canonicalização). RLS ganhou policy de
> INSERT/UPDATE pra `authenticated` além de SELECT (`organization_id in
> auth_organization_ids()`) — diferente de `feed_events`/
> `radar_staging_events` (só `SUPABASE_SECRET_KEY` escreve), porque
> `get-page-*` grava aqui usando o client autenticado com o JWT do usuário,
> não a chave secreta (mesmo padrão de "Autenticação do client Supabase"
> já usado por todo o resto deste módulo).

| Campo             | Tipo           | Obrigatório | Descrição |
|--------------------|----------------|-------------|-----------|
| `id`               | `uuid`         | sim | PK |
| `organization_id`  | `uuid`         | sim | FK → `organizations(id)` ON DELETE CASCADE |
| `page`             | `text`         | sim | mesmo slug de `envelope.page` (`overview`, `narratives`, `narrative_detail` etc.) |
| `section`          | `text`         | sim | ✅ **2026-07-14** (migration `20260809050000`) — `'main'` é o `narrative_text` genérico de sempre (Camada 0/1); outros valores (`'featured_content'`, `'period_comparison'`, `'overview'`) são seções Camada 2 específicas de uma página só. Default `'main'`, mas todo código precisa gravar/filtrar explicitamente — nunca confiar no default (ver blockquote de topo). |
| `period_start`     | `date`         | sim | |
| `period_end`       | `date`         | sim | |
| `filters_hash`     | `text`         | sim | hash determinístico de `filters_applied` (evita a tabela crescer sem limite com toda combinação de filtro já vista — mesmas combinações reusam a mesma linha) |
| `narrative_text`   | `text`         | sim | o texto composto |
| `layer`            | `text`         | sim | `layer_1` \| `layer_2` — qual camada gerou (Camada 0 nunca grava aqui, é sempre recalculada) |
| `is_final`         | `boolean`      | sim | `true` quando `period_end < current_date` no momento da geração — período fechado, texto nunca mais regenerado pra essa chave |
| `generated_at`     | `timestamptz`  | sim | quando a composição rodou de fato (não confundir com `created_at`/`updated_at` — pode ser regravado com `generated_at` novo se `is_final = false` e um gatilho de invalidação disparar) |
| `created_at`/`updated_at` | `timestamptz` | sim | padrão (`set_updated_at`) |

**Índices**: unique `(organization_id, page, section, period_start, period_end, filters_hash)` — ✅ ganhou `section` em 2026-07-14 (antes: sem essa coluna).

**Políticas RLS**: ✅ 3 policies (`page_narrative_synthesis_select_org`/`_insert_org`/`_update_org`,
migration `20260802020000`) — todas `organization_id in (select auth_organization_ids())`, mesmo
padrão já usado em `foundation`. Mesma ressalva de "Autenticação do client Supabase" em
`edge-functions-per-page.md` — a Edge Function que lê/escreve esta tabela usa o JWT do usuário,
não a chave secreta, por isso precisa de INSERT/UPDATE explícitos (diferente de `feed_events`,
só-leitura pra `authenticated`).

## Dependências técnicas

- Módulo `event-radar` publicando em `feed_events` (pré-requisito — sem ele, todas as páginas
  caem permanentemente no template de "sem eventos" da Camada 0). ✅ **Satisfeito desde
  2026-07-31** — `event-radar` 1.1-1.4/1.6 implementados, `feed_events` populada por
  `event-radar-agent-orchestrator`.
- Tabela própria `page_narrative_synthesis` (ver "Dados envolvidos" acima) — **não** é o mesmo
  mecanismo de cache do envelope (`edge-functions-per-page.md`, TTL 5min); são independentes de
  propósito (um é persistência de texto por período, o outro é cache de resposta HTTP). ✅
  **Implementada (2026-08-02, migration `20260802020000`)**.
- ✅ **Skill `humanizer-pt-br` instalada (2026-08-06)** — pedido explícito do usuário
  (`npx skills add https://github.com/mackswendhell/humanizer-pt-br --skill humanizer-pt-br`),
  vive em `.agents/skills/humanizer-pt-br/SKILL.md`, symlinkada pro Claude Code. Corrige a nota
  anterior (2026-08-02), que confirmava a ausência da skill no repositório na época. A skill em si
  é um guia interativo de edição (recebe um texto pronto e o reescreve, com checklist/pontuação de
  qualidade) — não é um trecho de prompt colável direto na API da Anthropic. Por isso o tom da
  composição (Camada 1) continua vindo de instrução direta em `NARRATIVE_SYNTHESIS_SYSTEM_PROMPT`
  (`aggregated-metrics-service.ts`), agora **adaptada dos padrões concretos da skill** (frases
  diretas, sem "gancho" dramático, sem vocabulário de IA tipo "além disso"/"desempenha papel
  fundamental", sem atribuição vaga, sem conclusão genérica/otimista, sem gerúndio final de falsa
  profundidade, sem regra dos 3 forçada) — mesmo padrão replicado em
  `event-radar/agent-orchestrator.md`'s `SYSTEM_PROMPT` e em `narrative-summary-composer` (ver
  `foundation/narratives.md`, "Resumo executivo (produtor)").

## Referências relacionadas

- [overview.md](overview.md)
- [standard-json-envelope.md](standard-json-envelope.md)
- [sql-aggregation.md](sql-aggregation.md)
- [edge-functions-per-page.md](edge-functions-per-page.md)
- [block-mapping-per-page.md](block-mapping-per-page.md)
