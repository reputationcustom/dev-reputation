---
tipo: feature-spec
módulo: event-radar
funcionalidade: frontend-highlights-feed
status: rascunho
atualizado: 2026-08-01
---

# Radar de Eventos — Feed das Últimas 72h (frontend)

> ⚠️ **Rascunho — Fase 1 (Especificação)**, pedido do usuário: "crie a
> documentação do frontend do módulo event-radar de acordo com o que foi
> desenvolvido. A ideia é que o usuário tenha uma visão rápida e fácil do
> que aconteceu nas últimas 72h." Este arquivo só documenta — nenhum
> código foi escrito nesta sessão. Segue a divisão em duas fases já
> definida em `overview.md`: isto é a Fase 1; a Fase 2 (implementação) só
> começa depois que este spec estiver `pronto`.
>
> Este é o **primeiro spec de frontend do módulo `event-radar`** —
> `overview.md`, "Rotas/Páginas" ainda diz "este módulo não expõe páginas
> próprias... as páginas de frontend que exibem sua saída são as de
> `aggregated-metrics` (bloco `highlights`)". Isso continua verdadeiro no
> sentido de que não há uma rota `/eventos` nova aqui — este spec descreve
> um **widget**, dentro de uma página já existente de `intelligence-center`,
> não uma página nova. Ver "Por que não é o bloco `highlights` genérico"
> abaixo pro porquê de não bastar reaproveitar o que já está especificado.

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

> Fora de escopo deste spec: réplica do widget em outras páginas, ou uma
> página dedicada tipo `/eventos` com histórico completo/paginado. Se o
> uso real mostrar que 72h fixas na Visão Geral não bastam, isso é uma
> extensão natural — não decidida aqui.

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
   3h", "há 2 dias" — `formatRelativeDate`, `lib/date/format.ts`), `title`,
   `summary`, `tags` (chips pequenos), e um link "Ver Narrativa →" quando
   `related_narrative_id` existe (abre `narrative-detail-modal.tsx`, mesmo
   padrão de clique já usado em `NarrativeCard`/`NarrativesTable`).
5. Cada card tem um menu de feedback (ver "Feedback do analista" abaixo).

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
- **Cada card** (reaproveita o padrão visual de borda colorida por
  severidade já existente em `HighlightsPanel`, não reinventa):
  - Ícone por `event_type`: `volume_spike` (↑), `volume_drop` (↓),
    `sentiment_change`/`negative_sentiment_increase`/
    `negative_sentiment_spike` (mesmo ícone de sentimento, cor pela
    severidade). Sem ícone novo por regra — reaproveita o vocabulário
    visual já usado em `score-badges.tsx`.
  - `RiskBadge` com `severity`/`severity_label` (mapeamento 1:1 já
    existente — `severity` é o mesmo enum de `risk_level`).
  - Tempo relativo via `formatRelativeDate(created_at, timezone)` — mesma
    função já usada no resto do produto (`lib/date/format.ts`), nunca uma
    formatação de data nova.
  - `title` (negrito), `summary` (texto secundário), `tags` (chips,
    reaproveitando o estilo de pill já usado em `narrative-card.tsx`).
  - Link "Ver Narrativa →" (só quando `related_narrative_id` existe) —
    abre o modal de detalhe (intercepting route já existente,
    `@modal/(.)narratives/[id]`), mesmo comportamento de qualquer outro
    card/tabela que já linka pra uma Narrativa.
- **Feedback do analista**: um ícone de "⋮" (mesmo padrão de menu de ações
  já usado em `users-admin-view.tsx`) abrindo 4 opções — Útil / Irrelevante
  / Severidade errada / Explicação incorreta (`feedback_type`, ver
  `data-model.md`) — mais um campo de comentário opcional. Ao enviar:
  `INSERT` direto em `feed_event_feedback` via `supabase-js` (sem Edge
  Function — mesma decisão já registrada em `data-model.md`/`CLAUDE.md`
  quando o schema foi criado: toda validação cabe em RLS/CHECK). Toast de
  confirmação (regra transversal #3). Depois de enviar, o card mostra um
  estado "Feedback enviado ✓" no lugar do menu — **suave, só client-side**:
  não há constraint no banco impedindo múltiplos feedbacks da mesma pessoa
  no mesmo card (`data-model.md` não define um por design), então um
  reload da página permite enviar de novo. Aceitável pro MVP — não é um
  gate de segurança, é só evitar clique duplo acidental.
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
  de 72h) — nova function SQL `get_recent_highlights(p_organization_id
  uuid, p_hours integer default 72, p_limit integer default 10)`, leitura
  pura sobre `feed_events`, mesmo princípio de `get_active_highlights`
  ("nunca recalcula insight, apenas filtra e ordena o que o radar já
  publicou").
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

- Nova function SQL `get_recent_highlights` (migration futura, Fase 2).
- Nova Edge Function ou extensão de uma já existente pra expor
  `get_recent_highlights` ao frontend — a decidir na Fase 2 se isso vira
  parte de `get-page-overview` (um bloco a mais no envelope daquela
  página especificamente) ou uma function RPC chamada direto pelo cliente
  (mais simples, já que não depende do período/filtros do header como o
  resto do envelope) — **decisão de implementação, não de produto,
  registrada aqui como aberta**.
- Componente novo `RecentEventsPanel` + `hooks/use-recent-highlights.ts`
  (padrão 3-estados já usado por todo hook de carregamento do projeto).
- `formatRelativeDate` (`lib/date/format.ts`) já existe, sem mudança.

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
