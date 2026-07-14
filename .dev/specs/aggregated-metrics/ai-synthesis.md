---
tipo: feature-spec
módulo: aggregated-metrics
funcionalidade: ai-synthesis
status: implementado
atualizado: 2026-07-14
---

# Síntese Narrativa da Página (`narrative_text`)

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
    envelope (sync da Brandwatch concluiu um ciclo, ou usuário clicou "Atualizar dados"). ⚠️ **Na
    implementação real, isso ainda não roda**: nenhum dos dois gatilhos existe no produto hoje
    (mesmo gap que já bloqueia a invalidação do `page_cache`, `_pending.md` #21) — então, na
    prática, uma linha já existente em `page_narrative_synthesis` é **sempre devolvida como
    está**, período aberto ou fechado, nunca recomposta (ver "Fluxo principal" abaixo). `is_final`
    continua sendo gravado corretamente (`period_end < hoje` no momento da geração); só não tem
    nenhum consumidor lendo essa diferença ainda.

### Camada 2 — Nova análise via IA (exceção, precisa de justificativa)

Só existe se um bloco específico não tiver equivalente no radar (por exemplo, uma leitura pura
de `breakdowns`/`trends` sem nenhum evento associado, mas que ainda assim precise de
comentário qualitativo). Antes de implementar a Camada 2 para qualquer página, o Claude Code
deve registrar no spec da página por que a Camada 0 ou 1 não foram suficientes — mesma regra de
"justificar chamada extra de IA" que já vale para o `event-radar`.

## Fluxo principal

1. A Edge Function da página já retornou `highlights` (leitura de `feed_events`, ver
   `sql-aggregation.md`).
2. O sistema conta quantos highlights estão no escopo da página:
   - 0 ou 1 → Camada 0, monta `narrative_text` na hora, sem IA, sem persistência (é
     determinístico, custa nada recalcular a cada vez).
   - 2+ → Camada 1: busca `page_narrative_synthesis` pela chave exata
     `(organization_id, page, period_start, period_end, filters_hash)`.
     - Linha existe → retorna o texto armazenado direto, **sempre, sem chamar IA** — mesmo se
       `is_final = false` (período ainda aberto). ⚠️ Não existe hoje nenhum gatilho que force uma
       recomposição de uma linha já existente (ver "Camada 1" acima e `_pending.md` #21) — essa
       branch é aspiracional, documentada porque a tabela/coluna `is_final` já está pronta pra
       ela, mas nenhum código a lê ainda.
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
| Chamada de composição (Camada 1) falha              | `narrative_text` permanece com o fallback da Camada 0, nunca `null` sem explicação; nada é gravado em `page_narrative_synthesis` (só grava em caso de sucesso) |
| Highlights mudam pra um período **aberto** já com linha em `page_narrative_synthesis` | ⚠️ **Hoje não regenera** — o texto já gravado é devolvido como está, mesma limitação do "Fluxo principal" acima. A intenção original (regenerar via `UPDATE` quando sync concluir/usuário clicar "Atualizar dados") depende dos gatilhos de `_pending.md` #21, que não existem no produto ainda. Comportamento atual, não um bug — revisitar se isso passar a incomodar na prática |
| Highlights mudam pra um período **fechado** já com `is_final = true` | Nunca regenera — período fechado é permanente por definição, mesmo que dado novo chegasse atrasado (caso raro, mesma aceitação de lag já usada em outras partes do produto) |
| Página sem highlights e sem dado suficiente (ex: organização nova) | Template da Camada 0 deve indicar claramente ausência de dados, nunca inventar tendência |

## Regras de negócio

- A IA nunca deve receber `ui_meta`, nem os blocos numéricos brutos (`metrics`, `breakdowns`,
  `trends`) na Camada 1 — só os textos (`summary`/`explanation`) dos highlights envolvidos. Isso
  é o que torna a chamada barata: ela compõe texto, não analisa números.
- Nenhuma página deve gerar uma chamada de IA por carregamento — Camadas 1/2 só chamam IA quando
  não existe linha aproveitável em `page_narrative_synthesis` pra aquela chave exata (ver
  "Fluxo principal"), nunca por TTL de cache expirando sozinho.
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
| `period_start`     | `date`         | sim | |
| `period_end`       | `date`         | sim | |
| `filters_hash`     | `text`         | sim | hash determinístico de `filters_applied` (evita a tabela crescer sem limite com toda combinação de filtro já vista — mesmas combinações reusam a mesma linha) |
| `narrative_text`   | `text`         | sim | o texto composto |
| `layer`            | `text`         | sim | `layer_1` \| `layer_2` — qual camada gerou (Camada 0 nunca grava aqui, é sempre recalculada) |
| `is_final`         | `boolean`      | sim | `true` quando `period_end < current_date` no momento da geração — período fechado, texto nunca mais regenerado pra essa chave |
| `generated_at`     | `timestamptz`  | sim | quando a composição rodou de fato (não confundir com `created_at`/`updated_at` — pode ser regravado com `generated_at` novo se `is_final = false` e um gatilho de invalidação disparar) |
| `created_at`/`updated_at` | `timestamptz` | sim | padrão (`set_updated_at`) |

**Índices**: unique `(organization_id, page, period_start, period_end, filters_hash)`.

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
