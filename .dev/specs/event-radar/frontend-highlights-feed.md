---
tipo: feature-spec
módulo: event-radar
funcionalidade: frontend-highlights-feed
status: implementado
atualizado: 2026-07-14
---

# Radar de Eventos — Feed das Últimas 72h (frontend)

> ✅ **"Resumo executivo" reformulado — de estatísticas pra texto
> período-escopado (2026-07-14, mesmo dia da implementação original)** —
> 2 problemas reais relatados pelo usuário: (1) "não está aparecendo o
> texto do resumo executivo do radar de 72h" — a versão original
> (`RecentEventsExecutiveSummary`) nunca teve um texto de verdade, só
> contagens/cards, apesar do nome "resumo executivo"; (2) "ao alternar
> entre mensal, diário e semanal, o resumo permanece considerando os
> últimos 3 dias" — porque a fonte (`useRecentHighlights`) é,
> deliberadamente, a janela fixa de 72h deste widget (ver "Regra
> fundamental" abaixo), nunca o período selecionado no header — o que é
> correto pra "Lista", mas não é o que "resumo executivo" deveria
> significar. Resolvido substituindo a aba "Resumo executivo" por
> `narrative_text` (`aggregated-metrics/ai-synthesis.md`, já
> período-escopado por construção) — a página hospedeira (`/overview` ou
> `/radar`) passa `narrativeText`/`page`/`onGenerated` como props pro
> `RecentEventsPanel`, que renderiza o mesmo `NarrativeTextPanel` usado em
> "O que os gráficos mostram?"/"Insights" nas outras páginas. `/radar`
> (que antes não buscava nenhum envelope) passou a chamar
> `usePageEnvelope("get-page-overview")` só pra isso — não existe
> `get-page-radar` dedicado, então o texto exibido é o mesmo "Visão Geral"
> da organização, período-escopado pelo header. Novo prop
> `blankOnCustom` em `NarrativeTextPanel` faz esta instância específica
> ficar em branco (só o botão "Analisar período com IA") em período
> personalizado, em vez do template Camada 0 que todo outro uso desse
> componente mostra — pedido explícito do usuário só pra este toggle. A
> aba "Lista" continua exatamente como era (fixa em 72h) —
> `RecentEventsExecutiveSummary` (contagens por severidade/tipo + top 5
> eventos) foi removida, sem substituto — a informação relevante já está
> na aba "Lista".

> ✅ **Duas visualizações alternáveis (2026-07-14)** — pedido do usuário:
> "Radar de Eventos deve ter duas possibilidades (a lista dos eventos
> como está hoje e o resumo executivo) o usuário pode alternar entre
> essas visualizações." `RecentEventsPanel` ganhou um toggle "Lista"/
> "Resumo executivo" no topo (mesmo estilo visual do toggle de período do
> header global) — implementado uma única vez no próprio componente
> compartilhado, não em cada página que o renderiza, já que tanto o
> widget de `/overview` quanto a página dedicada `/radar` consomem o
> mesmo `RecentEventsPanel`. "Resumo executivo"
> (`RecentEventsExecutiveSummary`) não faz nenhuma chamada de rede nova —
> é inteiramente derivado dos mesmos `highlights` já buscados por
> `useRecentHighlights` (contagem por severidade, contagem por
> `event_type`, os 5 eventos de maior `severity_score` em destaque) —
> agrupamento pra exibição, não um recálculo de score (mesma regra de
> "Nunca recalcula severidade/detecção" abaixo). Ver "Fluxo principal"
> item 3 e "Interface (UI)" pra detalhamento completo.
>
> ✅ **Implementado (2026-08-02)**, pedido do usuário: "reveja a
> documentação do frontend do event-radar, se estiver coerente e conciso
> com o que está desenvolvido, pode seguir com o desenvolvimento do
> frontend." Revisão encontrou 2 problemas reais de coerência, corrigidos
> antes do código: (1) a alegação de que `formatRelativeDate`
> (`lib/date/format.ts`) já produzia "há 3h" era falsa — essa função só
> tem granularidade de **dia** (Hoje/Ontem/há N dias), sem hora/minuto;
> resolvido adicionando `formatRelativeTime` (nova função no mesmo
> arquivo, cai pra `formatRelativeDate` a partir de 24h); (2) a "decisão de
> implementação em aberto" (Edge Function vs. RPC direta) foi resolvida a
> favor de **RPC direta do client** (`supabase.rpc('get_recent_highlights', ...)`,
> sem Edge Function nova) — mesmo padrão já usado por
> `use-narratives-list.ts`/`use-communication-types.ts` (leitura protegida
> só por RLS), justificado pelo próprio argumento do spec ("não depende do
> período/filtros do header como o resto do envelope"). Migration
> `20260802040000`, `hooks/use-recent-highlights.ts`,
> `components/intelligence-center/recent-events-panel.tsx`. `npx tsc
> --noEmit`/`npm run build` confirmados limpos (19 rotas, `/overview`
> cresceu de 4.85kB pra 6.18kB de First Load JS).
>
> Este é o **primeiro spec de frontend do módulo `event-radar`** —
> `overview.md`, "Rotas/Páginas" foi atualizado — não há uma rota
> `/eventos` nova, este spec descreve um **widget** dentro de uma página já
> existente de `intelligence-center` (`/overview`), não uma página nova.
> Ver "Por que não é o bloco `highlights` genérico" abaixo pro porquê de
> não bastar reaproveitar o que já está especificado.

## Objetivo

Dar ao usuário uma visão rápida e fácil de tudo que o motor de detecção +
IA por evento (`event-radar`) publicou nas **últimas 72 horas**, num único
lugar — sem precisar caçar informação espalhada pelas páginas de
`intelligence-center`, e sem depender do seletor de período global (que
pode estar em "Diário"/"Mensal"/qualquer coisa) pra saber "o que aconteceu
recentemente".

## Por que não é o bloco `highlights` genérico

`aggregated-metrics/standard-json-envelope.md` já especifica um bloco
`highlights` por página, lido via `get_active_highlights`
(`aggregated-metrics/sql-aggregation.md`) — mas esse bloco é filtrado pelo
**período selecionado no header daquela página** (`period.start`/
`period.end`), o mesmo período que rege `metrics`/`breakdowns`/`trends`.
Isso é o comportamento certo pra "highlights relevantes à janela que estou
analisando agora" em cada página — mas é o comportamento **errado** pro
pedido específico desta sessão: "últimas 72h" tem que significar sempre as
mesmas 72h corridas, **independente** de qual período o usuário tenha
selecionado em qualquer página. Por isso este widget usa uma fonte de
dado própria (`get_recent_highlights`, abaixo), não `get_active_highlights`
— os dois convivem, servindo propósitos diferentes: um por página/período,
um fixo/sempre-atual.

## Onde vive

**Visão Geral (`/overview`)**, no lugar que hoje é ocupado pelo
`HighlightsPanel` vazio (`components/intelligence-center/insights-panel.tsx`,
logo abaixo do gráfico de volume/sentimento — ver `CLAUDE.md`, "Segundo
round de UI polish do /overview"). É a página de "primeira tela" do
produto — o lugar certo pra um resumo rápido, exatamente o que o pedido
descreve. Renomeado de "Insights"/genérico para **"Radar de Eventos"**
(mesmo nome em português já usado pro módulo em `_glossary.md`/`_index.md`),
com o subtítulo "Últimas 72 horas" deixando o escopo temporal explícito na
própria UI, não só na documentação.

> ✅ **Extensão natural aplicada (2026-08-02)** — pedido do usuário: "a
> opção do radar no Menu principal não está aparecendo" (esperava um item
> de menu próprio, não só o widget embutido em `/overview`), seguido de
> "nessa página nova será possível acompanhar o que ocorreu nas últimas
> 72h, quais foram as tendências, etc. Basicamente o feed do que foi
> identificado nas últimas 72h." Nova rota **`/radar`** (item "Radar de
> Eventos" em `ANALYSIS_ITEMS`, `sidebar.tsx`) — mesmo `RecentEventsPanel`/
> janela fixa de 72h do widget de `/overview`, reaproveitado como página
> dedicada, não uma segunda fonte de dado. Os dois convivem: o widget em
> `/overview` continua sendo o resumo rápido da tela de entrada, `/radar`
> é o destino completo alcançável pelo menu. `PageHeaderBar` usado por
> consistência de navegação (organização visível), mas o seletor de
> período não afeta esta página — a janela permanece sempre fixa.

## Fluxo principal

1. Usuário abre `/overview` (ou já está nela — o widget carrega junto com
   o resto da página, independente do período selecionado no header).
2. Widget busca até `RECENT_HIGHLIGHTS_LIMIT` (10, mesma constante de
   paginação padrão do projeto não se aplica aqui — ver "Regras de
   negócio") eventos de `feed_events` da organização ativa com
   `created_at >= now() - interval '72 hours'`, **incluindo eventos já
   fechados** (`closed_at` preenchido) — "o que aconteceu" é histórico,
   não "o que está ativo agora"; um evento que já normalizou ainda é um
   fato que aconteceu nas últimas 72h.
3. Cards ordenados por `created_at` desc (mais recente primeiro) — é uma
   linha do tempo, não um ranking por severidade (esse já existe no bloco
   `highlights` de cada página). Severidade continua visível por card
   (cor da borda + badge), só não decide a ordem.
4. Cada card mostra: ícone por `event_type`, badge de severidade
   (`RiskBadge`, reaproveitado de `score-badges.tsx`), tempo relativo ("há
   3h", "há 2 dias" — `formatRelativeTime`, `lib/date/format.ts`, nova
   função com granularidade de hora/minuto; `formatRelativeDate` existente
   só tem granularidade de dia, insuficiente pra uma janela de 72h onde a
   maioria dos eventos aconteceu "hoje"), `title`, `summary`, `tags` (chips
   pequenos), e um link "Ver Narrativa →" quando `related_narrative_id`
   existe (`next/link` pra `/narratives/[id]`, mesma rota que a
   intercepting route `@modal/(.)narratives/[id]` já intercepta pra abrir
   como modal — mesmo padrão de clique já usado em
   `NarrativeCard`/`NarrativesTable`).
5. Cada card tem um menu de feedback (ver "Feedback do analista" abaixo).
6. Um toggle "Lista"/"Resumo executivo" no topo do widget alterna entre a
   visualização de cards (itens 3-5 acima, sempre 72h fixo) e o
   `narrative_text` período-escopado da página hospedeira (✅ reformulado
   2026-07-14 — ver blockquote de topo; versão original mostrava contagens
   agregadas dos mesmos eventos de 72h, não um texto, e nunca refletia o
   período selecionado no header).

## Interface (UI)

- **Componente novo**: `RecentEventsPanel`
  (`components/intelligence-center/recent-events-panel.tsx`), substituindo
  o uso atual de `HighlightsPanel` em `overview/page.tsx` (`HighlightsPanel`
  em si não é removido do arquivo — outras páginas ainda podem vir a usar
  o bloco `highlights` genérico por período no futuro; só `/overview` para
  de renderizá-lo neste lugar específico).
- **Cabeçalho do widget**: título "Radar de Eventos" (`font-bold
  text-text-primary`, mesma convenção de todo título de widget — regra
  transversal #7 do `CLAUDE.md`) + subtítulo pequeno "Últimas 72 horas".
- **Toggle "Lista"/"Resumo executivo"** (dentro do próprio
  `RecentEventsPanel`, acima do conteúdo — mesmo estilo visual do
  segmented control de período do header global,
  `bg-accent-blue text-white` no item ativo): alterna qual das duas
  visualizações abaixo é renderizada. Estado local (`useState`), não
  persiste entre navegações (mesmo padrão de `filtrosOpen` no header).
  - **Lista** (default): os cards individuais, exatamente como descrito
    nos itens 3-5 do "Fluxo principal".
  - **Resumo executivo** — ✅ **reformulado 2026-07-14** (ver blockquote
    de topo): renderiza `NarrativeTextPanel` (mesmo componente de "O que
    os gráficos mostram?"/"Insights" nas outras páginas) com
    `narrativeText`/`page`/`onGenerated` recebidos via prop da página
    hospedeira (`/overview` já tinha `envelope.narrative_text` pronto;
    `/radar` passou a chamar `usePageEnvelope("get-page-overview")` só
    pra isso). Período-escopado por construção (mesma chave de
    `page_narrative_synthesis` já usada em toda outra página) — muda ao
    trocar Diário/Semanal/Mensal no header, ao contrário da versão
    anterior. `blankOnCustom` (novo prop de `NarrativeTextPanel`) faz esta
    instância específica renderizar em branco (só o botão "Analisar
    período com IA") em período personalizado, em vez do template
    Camada 0 que todo outro uso do componente mostra. **Removido**: as 5
    estatísticas/chips por tipo/top 5 eventos (`RecentEventsExecutiveSummary`)
    da versão original (2026-07-14, mesmo dia — nunca chegou a ficar mais
    de algumas horas em produção) — a informação de eventos individuais já
    está na aba "Lista", e a versão em estatísticas nunca tinha um texto
    de verdade, o que motivou a reformulação.
- **Cada card** (reaproveita o padrão visual de borda colorida por
  severidade já existente em `HighlightsPanel`, não reinventa):
  - Ícone por `event_type`: `volume_spike` (↑), `volume_drop` (↓),
    `sentiment_change`/`negative_sentiment_increase`/
    `negative_sentiment_spike` (mesmo ícone de sentimento, cor pela
    severidade). Sem ícone novo por regra — reaproveita o vocabulário
    visual já usado em `score-badges.tsx`.
  - `RiskBadge` com `severity`/`severity_label` (mapeamento 1:1 já
    existente — `severity` é o mesmo enum de `risk_level`).
  - Tempo relativo via `formatRelativeTime(created_at, timezone)` (nova
    função em `lib/date/format.ts`, mesmo arquivo/convenção de fuso do
    resto do produto — granularidade de hora/minuto, cai pra
    `formatRelativeDate` a partir de 24h).
  - `title` (negrito), `summary` (texto secundário), `tags` (chips,
    reaproveitando o estilo de pill já usado em `narrative-card.tsx`).
  - Link "Ver Narrativa →" (só quando `related_narrative_id` existe) —
    abre o modal de detalhe (intercepting route já existente,
    `@modal/(.)narratives/[id]`), mesmo comportamento de qualquer outro
    card/tabela que já linka pra uma Narrativa.
- **Feedback do analista**: um ícone de "⋮" abrindo 4 opções — Útil /
  Irrelevante / Severidade errada / Explicação incorreta (`feedback_type`,
  ver `data-model.md`). ⚠️ **Implementado sem o campo de comentário
  opcional** (simplificação deliberada, não um esquecimento — clicar numa
  opção já envia direto, sem um segundo passo de texto livre; a coluna
  `comment` de `feed_event_feedback` fica disponível no schema pra uma
  extensão futura, se o produto quiser). Dropdown simples (`absolute`, sem
  portal) — diferente de `UserRowMenu` (`user-row-menu.tsx`, que usa
  `createPortal` porque a tabela de usuários vive num container
  `overflow-x-auto`, que clipa um menu `absolute`); `RecentEventsPanel` é
  uma lista vertical simples, sem esse problema de clipping, então o
  padrão mais simples se aplica. Ao enviar: `INSERT` direto em
  `feed_event_feedback` via `supabase-js` (sem Edge Function — mesma
  decisão já registrada em `data-model.md`/`CLAUDE.md` quando o schema foi
  criado: toda validação cabe em RLS/CHECK). Toast de confirmação (regra
  transversal #3). Depois de enviar, o card mostra um estado "Feedback
  enviado ✓" no lugar do menu — **suave, só client-side**: não há
  constraint no banco impedindo múltiplos feedbacks da mesma pessoa no
  mesmo card (`data-model.md` não define um por design), então um reload
  da página permite enviar de novo. Aceitável pro MVP — não é um gate de
  segurança, é só evitar clique duplo acidental.
- **Estados**: loading = skeleton (regra transversal #1, mesmo padrão de
  `SKELETON_ROWS` já usado em outras listas); erro = `<ErrorMessage
  onRetry />` (regra do "Backend communication failures" do `CLAUDE.md`);
  vazio = mensagem simples "Nenhum evento nas últimas 72 horas" (sem
  necessidade de mostrar uma ação primária aqui — este widget é
  complementar à página, não a razão dela existir, então a regra
  transversal #2 não se aplica da mesma forma que num CRUD principal).

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Organização sem nenhum evento nas últimas 72h | Estado vazio, mensagem honesta — não esconder o widget inteiro |
| `event-radar` 1.4/1.5 nunca rodou pra essa organização (`feed_events` sem nenhuma linha) | Mesmo estado vazio — indistinguível de "sem eventos recentes" pro usuário final, não há necessidade de diferenciar as duas causas na UI |
| Falha ao carregar | `<ErrorMessage retry />`, nunca um spinner preso indefinidamente |
| Falha ao enviar feedback | Toast de erro, menu de feedback continua disponível pra tentar de novo |
| Usuário sem `related_narrative_id` no card (evento de escopo `query`/`platform`) | Card renderiza normalmente, só sem o link "Ver Narrativa →" |

## Regras de negócio

- **Janela fixa de 72h, nunca o período do header** — é a regra central
  deste spec, já justificada acima. `RECENT_HIGHLIGHTS_HOURS = 72`
  documentado como constante única (SQL e frontend), não um número mágico
  espalhado.
- **Limite de itens**: até 10 cards (mesmo `DEFAULT_PAGE_SIZE` já usado
  como convenção de lista no projeto, `components/ui/pagination.tsx`) —
  não é uma paginação de verdade (não há "próxima página" neste widget,
  é um resumo, não uma lista completa), só um teto pra não estourar o
  card visualmente numa organização com muitos eventos na janela.
- **Inclui eventos fechados** (`closed_at` preenchido) — diferente do
  bloco `highlights` genérico, que só mostra eventos ativos dentro do
  escopo/período da página. Aqui o objetivo é "o que aconteceu", não "o
  que está acontecendo agora".
- **Nunca recalcula severidade/detecção** — mesma regra já estabelecida
  pra `get_active_highlights` (`sql-aggregation.md`): se um evento parecer
  "errado" ou "faltando", o ajuste é no `event-radar` (thresholds, regras),
  nunca uma lógica nova aqui.
- **Feedback é sempre pós-publicação**, nunca um gate — mesma regra já
  fixada em `schema-integration.md`.

## Dados envolvidos

- **Lê**: `feed_events` (organização ativa, `created_at` dentro da janela
  de 72h) — ✅ **`get_recent_highlights(p_organization_id uuid, p_hours
  integer default 72, p_limit integer default 10)` implementada (migration
  `20260802040000`)**, leitura pura sobre `feed_events`, mesmo princípio de
  `get_active_highlights` ("nunca recalcula insight, apenas filtra e
  ordena o que o radar já publicou"). Chamada direto do client
  (`security invoker`, RLS de `feed_events` aplica normalmente).
- **Escreve**: `feed_event_feedback` (INSERT direto do cliente, já
  implementado — ver `data-model.md`).
- ⚠️ **Mudança necessária no contrato do envelope, ainda não feita**: o
  tipo `Highlight` (`packages/shared-types/src/envelope.ts` +
  `standard-json-envelope.md`) **não tem `id` nem `created_at`** hoje —
  sem `id`, não há como vincular um feedback a um card específico
  (`feed_event_feedback.feed_event_id`); sem `created_at`, não há como
  calcular "há Xh" nem ordenar cronologicamente. Este widget não reaproveita
  o tipo `Highlight`/bloco `highlights` do envelope padrão (ver "Por que
  não é o bloco `highlights` genérico" acima) — usa sua própria forma de
  resposta (`get_recent_highlights` já retorna `id`/`created_at` desde o
  início, sem precisar alterar o contrato do envelope existente e sem
  arriscar quebrar as páginas que já consomem `Highlight` como está).

## Permissões

Mesma tabela de `executive-overview.md` — leitura só para membros da
organização (RLS via `auth_organization_ids()`); feedback: qualquer
usuário autenticado da organização (RLS já implementada,
`feed_event_feedback_insert_own`).

## Dependências técnicas

- ✅ Function SQL `get_recent_highlights` (migration `20260802040000`).
- ✅ **Resolvido**: RPC chamada direto pelo cliente (`supabase.rpc(...)`,
  `hooks/use-recent-highlights.ts`) — sem Edge Function nova, sem bloco no
  envelope de `get-page-overview`. Decisão a favor da opção mais simples,
  já que este widget genuinamente não depende do período/filtros do
  header como o resto do envelope (mesmo padrão de leitura direta via RLS
  já usado por `use-narratives-list.ts`/`use-communication-types.ts`).
- ✅ Componente `RecentEventsPanel`
  (`components/intelligence-center/recent-events-panel.tsx`) +
  `hooks/use-recent-highlights.ts` (padrão 3-estados já usado por todo
  hook de carregamento do projeto).
- ✅ `formatRelativeTime` — nova função em `lib/date/format.ts`
  (granularidade de hora/minuto, cai pra `formatRelativeDate` a partir de
  24h) — a função existente sozinha não bastava, ver blockquote de topo.
- ✅ Toggle "Lista"/"Resumo executivo" (2026-07-14) — reformulado no mesmo
  dia pra usar `NarrativeTextPanel`/`narrative_text` (`aggregated-metrics/
  ai-synthesis.md`) em vez de estatísticas locais; `/radar` ganhou
  `usePageEnvelope("get-page-overview")`, sem dependência nova além disso.

## Gaps conhecidos (fora de escopo deste spec)

- Página dedicada de histórico completo/paginado de eventos (além das
  72h) — não pedida, não desenhada aqui.
- Filtro por tipo de evento/severidade dentro do próprio widget — o
  pedido foi "visão rápida e fácil", um filtro a mais vai contra esse
  objetivo; o bloco `highlights` genérico de cada página já cobre uma
  visão mais filtrável quando necessário.
- Notificação em tempo real (push/toast quando um evento novo é
  publicado) — este spec é só sobre a exibição ao carregar a página, não
  sobre atualização ao vivo.

## Referências relacionadas

- [overview.md](overview.md)
- [data-model.md](data-model.md) — `feed_events`/`feed_event_feedback`
- [agent-orchestrator.md](agent-orchestrator.md)
- [aggregated-metrics-integration.md](aggregated-metrics-integration.md)
- [../aggregated-metrics/standard-json-envelope.md](../aggregated-metrics/standard-json-envelope.md) — bloco `highlights` genérico (por página/período)
- [../aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md) — `get_active_highlights`
- [../intelligence-center/executive-overview.md](../intelligence-center/executive-overview.md)
