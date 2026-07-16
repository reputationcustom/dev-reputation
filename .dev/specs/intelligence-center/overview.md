---
tipo: module-overview
módulo: intelligence-center
status: pronto
atualizado: 2026-07-25
---

# Módulo: Intelligence Center (Sprint 2)

> Origem: protótipo de frontend "Comunicação Inteligente" (claude.ai/design,
> projeto `9a62a59b-c1f7-48b5-a05b-5d72e6f0db9a`) + documento de estrutura
> recomendada (`scratch/document.txt` do mesmo projeto). O protótipo
> interativo em si só implementa duas telas de verdade (Visão Geral e
> Narrativas list+detail); as demais páginas do documento de estrutura
> (Sentimento, Plataformas, Pautas Eleitorais) existem só como itens de
> menu desabilitados no protótipo (`navStatic`), sem tela construída. Este
> módulo nasce como a especificação escrita dessas páginas, seguindo o
> processo de spec-driven development do projeto — pedido explícito do
> usuário em 2026-07-12: "prosseguir com a especificação de todas as
> páginas do ponto de vista de frontend e também de captura dos dados na
> base integrada da brandwatch que já desenvolvemos no supabase".
>
> ✅ **Executive Overview movida para este módulo (2026-07-12)** — vivia em
> `foundation/executive-overview.md` apesar de `foundation` ser só backend
> (Sprint 1, sem UI própria por definição), o que conflitava com
> `aggregated-metrics/overview.md` (já listava `/overview` como página de
> `intelligence-center`, igual às demais). `intelligence-center` passa a
> ser dono de **todas** as páginas do frontend do produto (Sprint 2), não
> só as quatro de exploração — ver tabela abaixo.

## Objetivo

Dar à equipe de comunicação a visão executiva "de relance" (Executive
Overview) e um espaço de exploração livre (com filtros) sobre as
Narrativas e mentions já sincronizadas. Aqui o usuário aprofunda: qual
narrativa investigar, por que o sentimento mudou, onde (plataforma) a
conversa está acontecendo, e qual pauta política está ganhando ou perdendo
espaço.

## Funcionalidades

| Feature | Spec | Status | Depende de |
|---|---|---|---|
| Executive Overview | [executive-overview.md](executive-overview.md) | pronto | `foundation` (bw_query_metrics_daily, narratives, narrative_metrics, reporting.narratives_overview) |
| Exploração de Narrativas (lista + detalhe) | [narratives-exploration.md](narratives-exploration.md) | pronto | `foundation` (narratives, narrative_metrics, bw_query_top_authors); "Ações e decisões" lê `cases`, dado próprio deste módulo (ver [data-model.md](data-model.md)) |
| Análise de Sentimento | [sentiment-analysis.md](sentiment-analysis.md) | pronto | `foundation` (bw_query_metrics_daily, bw_query_topics, bw_query_demographics_daily) |
| Análise por Plataforma | [platform-analysis.md](platform-analysis.md) | pronto | `foundation` (bw_query_metrics_daily_by_platform) |
| Pautas Eleitorais | [electoral-themes.md](electoral-themes.md) | pronto | `foundation` (bw_categories hierarquia, narratives) |

✅ **Novo item de menu "Comunicação" (2026-07-25)**: o módulo
`communications` (Sprint 2.1, fora desta tabela — não é uma das 5 páginas
de exploração) adiciona um 7º item ao grupo `ANALYSIS_ITEMS` da `Sidebar`
compartilhada deste módulo, apontando para `/communications` (fora do
route group `(analytics)`, mesma convenção de `/admin/users`/`/perfil`).
O detalhe de Narrativa (`narratives-exploration.md`) ganha também uma
seção "Comunicações e impacto". Ver
[../communications/overview.md](../communications/overview.md) para o
módulo completo — ainda `rascunho`, não implementado.

Todas as cinco são **só leitura** — nenhuma escreve dado novo, todas
consomem exclusivamente o que `bw-sync`/`refresh_narrative_metrics()` já
sincronizam (ver `foundation/data-model.md`), servido através do envelope
único de `aggregated-metrics` (ver
[../aggregated-metrics/overview.md](../aggregated-metrics/overview.md)).
Nenhuma tem lógica de negócio no frontend (Princípio técnico 2).

✅ **Header global (2026-07-13, corrigido)**: as cinco páginas compartilham
os mesmos 2 seletores — organização ativa e período — especificados uma
única vez em [executive-overview.md](executive-overview.md), "Header",
não redescritos em cada página. ✅ **Título da página separado da barra de
controles (2026-07-12)**: `PageHeaderBar` (usado pelas 6 páginas, incl.
`/narratives/[id]`) passou a renderizar o `<h1>`/subtítulo da página fora
da barra branca de organização/período/filtros, soltos no canvas cinza
abaixo — igual ao protótipo real, ver `executive-overview.md` e
`CLAUDE.md`, "UI polish pass". **Sem seletor de Query** — Queries são
detalhe técnico, transparente ao usuário (pedido explícito, ver
"Fluxo principal" de `executive-overview.md`); quando uma organização tem
mais de uma Query, os dados de todas são combinados automaticamente.
Trocar organização reescopa os dados de **toda** a navegação, não só da
página atual.

## Premissas de shell/layout (2026-07-15)

Regras adicionadas a pedido do usuário, para toda a implementação de
frontend deste módulo (e qualquer módulo futuro que reutilize o mesmo
shell — ex: `event-radar`/`decision-center` nas Sprints 3/4). Não são só
sobre o Intelligence Center: cobrem a experiência de navegação da
aplicação inteira pós-login, então também valem para páginas hoje fora
deste módulo (`/admin/users`, `/perfil`) — ver gap ⚠️ abaixo.

1. **Menu sempre visível, exceto se o usuário ocultá-lo explicitamente.**
   O menu lateral (`Sidebar`) faz parte do shell padrão de toda página
   autenticada — não é algo que cada página decide mostrar ou não. Se o
   usuário oculta o menu, a UI precisa oferecer uma forma óbvia de
   reabri-lo (ex: um rail/botão fixo no lugar onde o menu estava) — nunca
   um estado sem saída que exija recarregar a página ou navegar para
   fora. O estado (aberto/oculto) deve persistir entre navegações dentro
   da sessão (ver item 3) — não voltar a "aberto" a cada troca de página.
2. **Toda a solução é responsiva**, seguindo o comportamento do protótipo
   "Comunicação Inteligente" (mesma fonte de `_design-tokens.md`) em
   telas menores — não só as 5 páginas de `intelligence-center`, qualquer
   tela nova do produto. ✅ **Breakpoint confirmado (2026-07-12)**: o
   protótipo real (`claude.ai/design`, arquivo `Comunicacao
   Inteligente.dc.html`) foi importado via `DesignSync` e seu próprio
   script confirma `window.innerWidth < 900` como o corte
   sidebar↔rail↔drawer-mobile — não o `lg` (1024px) padrão Tailwind usado
   até então. `tailwind.config.ts` ganhou `theme.extend.screens.shell =
   '900px'` (estende a escala padrão, não substitui) e
   `app/(intelligence-center)/layout.tsx` usa `shell:` no lugar de `lg:`
   para essa troca específica. Ver CLAUDE.md, "Prototype-parity pass on
   `intelligence-center`" para a lista completa de divergências
   corrigidas na mesma sessão (rail colapsado, `PageHeaderBar` ausente em
   `/narratives/[id]`, toggle "Filtros" ausente, grids sem passo `md:`).
3. **Menu, header e footer são fixos — nunca recarregam ao navegar entre
   páginas.** Já é o comportamento estrutural do App Router quando o
   shell vive num `layout.tsx` de route group (só o `children` troca,
   `Sidebar`/header não desmontam) — `app/(intelligence-center)/layout.tsx`
   já segue esse padrão para as 5 páginas do módulo. Essa é a razão
   técnica por trás da regra, não uma opção de implementação: qualquer
   nova página autenticada deve entrar dentro do mesmo route group (ou
   um irmão que reuse o mesmo shell), nunca montar um layout próprio que
   remonte o menu a cada navegação.
4. **Padrão visual único em toda a solução**, sempre a partir de
   `_design-tokens.md` — nenhuma tela redefine cor/tipografia própria
   (mesma regra que "Onde isso se aplica" de `_design-tokens.md` já
   registra para Sprint 2, agora explícita como premissa de todo o
   frontend, não só das 5 páginas já especificadas).
5. **Toda decisão de navegação prioriza a melhor experiência para o
   usuário** — ao especificar uma página nova ou um fluxo novo, a
   navegação (onde um link leva, quantos cliques, o que fica visível sem
   scroll) é parte do design da funcionalidade, não um detalhe deixado
   para a implementação decidir livremente.

✅ **Gap resolvido (2026-07-15)**, ver `_pending.md` item #12: `/admin/users`
e `/perfil` (módulo `auth`) foram movidos para dentro do route group
`(intelligence-center)` (`app/(intelligence-center)/admin/users/`,
`app/(intelligence-center)/perfil/`) — agora compartilham o mesmo shell
(itens 1 e 3), não só as 5 páginas de análise. `Sidebar` ganhou
colapso/expansão (rail «»/»» ) com estado no `layout.tsx` (que não
remonta entre navegações — App Router, item 1) + drawer mobile abaixo do
breakpoint `lg` (item 2) + um footer mínimo (item 3). Único item ainda em
aberto: breakpoint exato **não confirmado** contra o protótipo real —
`lg` do Tailwind foi usado como aproximação razoável, não um valor
validado (`_pending.md` item #15).

✅ **Rail colapsado ganha ícone por página + tooltip (2026-07-16)** —
pedido do usuário: o rail (item acima) mostrava só um ponto colorido por
item, herdado do protótipo original — sem nenhuma pista visual de qual
página cada um representa, o usuário só descobria passando o mouse item
por item. `components/intelligence-center/nav-icons.tsx` (novo) — um
ícone SVG desenhado à mão por rota (nenhuma lib de ícones nova, mesmo
princípio já usado pelo logo/gráficos deste projeto), herdando a cor
ativo/inativo via `currentColor` das mesmas classes de texto que o
`NavLink` já calculava para o modo expandido. `components/ui/tooltip.tsx`
ganhou `position="right"` — um tooltip `top`/`bottom` (centralizado
horizontalmente sobre o ícone) seria cortado pela borda esquerda da tela
numa coluna de 64px colada a ela; abrindo à direita, o tooltip sempre cai
sobre a área de conteúdo. `title`/`aria-label` no `<Link>` continuam como
estavam (leitor de tela + fallback nativo do navegador), o `Tooltip`
compartilhado é o que efetivamente aparece ao passar o mouse. Ver
CLAUDE.md, "Sidebar colapsada — ícones + tooltip por página", para o
detalhe completo.

## Premissas de visualização de dados (2026-07-15)

Regras adicionadas a pedido do usuário, a partir de uma revisão do
protótipo real — cobrem todo gráfico/tabela das 5 páginas deste módulo
(`TrendLineChart`/`BreakdownPanel`/`NarrativesTable`/badges de score em
`components/intelligence-center/`), não uma página específica.

1. **Todo gráfico precisa de rótulos visíveis** (eixos, valores nos
   pontos/segmentos, legendas) — nunca uma linha/barra sem indicação do
   que ela representa ou de que ordem de grandeza tem. Hoje
   `TrendLineChart` só mostra a data inicial/final abaixo do gráfico, sem
   nenhuma marcação de eixo Y (escala do valor) nem marcação de data por
   ponto — insuficiente para o usuário final entender o gráfico sem
   passar o mouse.
2. **Tooltip ao passar o mouse** sobre qualquer ponto/segmento de
   gráfico — mostra o valor exato + rótulo (data, categoria) daquele
   ponto especificamente. Nenhum gráfico tem isso hoje.

   ✅ **Resolvido, definitivo (2026-07-13)**: a regra 1 acima já pedia
   rótulo "nos pontos/segmentos" — em `TrendLineChart` isso significa o
   valor aparecendo desenhado junto ao ponto sob o cursor, não só num
   painel abaixo do gráfico. Esse rótulo foi implementado (2026-07-12),
   removido numa revisão seguinte (2026-07-19) por avaliação de que
   duplicava o painel abaixo, e o usuário pediu de volta explicitamente
   (2026-07-13, mesma frase da primeira vez: "rótulos... para que o
   usuário veja os valores das linhas ao mover o mouse sobre o gráfico").
   **Não remover de novo** sem confirmar antes — os dois existem juntos e
   não são redundantes: o rótulo no ponto (`charts/trend-line-chart.tsx`)
   é o requisito explícito desta regra; o painel abaixo continua útil pra
   comparar todas as séries de uma vez quando há mais de uma linha.
3. **Página Visão Geral permanece como no protótipo**: organização
   (seletor, se houver mais de uma), e os filtros rápidos de período
   Diário/Semanal/Mensal/Personalizado (com intervalo customizado via 2
   datas) — ver [executive-overview.md](executive-overview.md), "Header",
   para o mapeamento exato de cada botão para `period.start`/`period.end`.
   Layout dos widgets (cards → gráfico de evolução + sentimento geral →
   Insights → tabela de Narrativas) mantido, sem reordenar.
4. **Gráfico de linha com até 5 valores mostrando só percentual → gráfico
   de rosca (donut)**. Regra aplicada onde já existe hoje: a distribuição
   positivo/neutro/negativo (`breakdown.type === 'sentiment'`, sempre 3
   valores, sempre percentual — `item.pct`) passa de barras horizontais
   para um donut com rótulo+percentual por fatia + tooltip. **Não** se
   aplica aos breakdowns de plataforma/pauta (`ScoreList`) — o valor ali é
   `net_sentiment` (score -100..100, pode ser negativo), não um percentual
   puro, então doughnut não representaria o dado corretamente (mesma
   ressalva já registrada em `_design-tokens.md` sobre não confundir as
   duas escalas). `TrendLineChart` continua line chart em todo lugar onde
   já é usado hoje — nenhum dos usos atuais é uma série real de ≤5 pontos
   percentuais estáticos, então não há caso de conversão ali além do já
   listado.
5. **Valores de tabela iguais a 0 não são mostrados** — tratados como o
   mesmo estado vazio (`—`) já usado para `null`. Aplica-se a
   `NarrativesTable` (`sov_pct`) e ao número secundário exibido dentro dos
   badges de score (`SentimentBadge`/`RiskBadge`/`VelocityIndicator`/
   `ScoreBar` — o rótulo colorido continua aparecendo mesmo com score 0,
   só o número entre parênteses some). **Escopo deliberadamente restrito a
   tabelas/badges de tabela** — não se aplica a cards de KPI (`MetricCard`,
   os 4 cards do topo de `/narratives/[id]`) nem a listas de ranking
   (`AuthorsList`/`TermSignalsList`), onde um valor 0 ainda é informação
   relevante (ex: "0 menções nesta plataforma" é diferente de "sem dado
   ainda") — só em tabela o zero repetido em várias linhas vira ruído
   visual.

⚠️ **Não há biblioteca de gráficos no projeto** (`recharts`/`chart.js`/
`visx`/`d3`/etc.) — decisão deliberada já registrada em `CLAUDE.md`
("intelligence-center... implementado 2026-07-15": *"gráfico de série
temporal simples, SVG, sem dependência nova... não é uma decisão desta
sessão"*). As melhorias acima (eixos, tooltip, donut) continuam
implementadas em SVG bruto, sem adicionar dependência nova — se o volume
de gráficos crescer bastante em sprints futuras, vale reabrir essa
decisão com o usuário, mas não nesta rodada.

## Gaps de dados — resolvidos em 2026-07-12

Ao mapear o protótipo contra `foundation/data-model.md`, várias métricas
pedidas pelo desenho pareciam **não ter agregado oficial da Brandwatch**
disponível. O usuário pediu para rever a captura antes de aceitar omitir
qualquer uma — pesquisa mais a fundo contra
`developers.brandwatch.com/docs/chart-dimensions-and-aggregates` encontrou
fonte oficial para praticamente todas (migration `20260712020000`,
`bw-sync/index.ts`):

- **Autores únicos** (card do Executive Overview, detalhe de Narrativa) —
  ✅ resolvido via aggregate de chart `authors` ("distinct authors who
  posted"), oficial e não amostrado. `bw_query_metrics_daily.unique_authors`/
  `narrative_metrics.unique_authors`.
- **Autores únicos por plataforma** / **Engajamento médio por plataforma**
  (Plataformas) — ✅ resolvidos, mesmo aggregate `authors` +
  `engagementScore` já usados acima, dimensão `pageTypes` em vez de
  `categories`. `bw_query_metrics_daily_by_platform.unique_authors`/
  `.engagement_score`.
- **Sentimento por plataforma** (Sentimento) / **Sentimento por
  localização** (Sentimento) — ✅ resolvidos via aggregate `netSentiment`,
  dimensões `pageTypes`/`countries`/`continents`/`cities`/`regions`. ⚠️
  **Limitação que continua real, não um gap de captura**: `netSentiment`
  devolve um score único, não o split positivo/neutro/negativo do resto do
  produto (a API não combina 3 dimensões — `sentiment`+`pageTypes`+`days` —
  numa chamada só). Exibir como indicador visualmente distinto na UI.
- **Grafo de propagação completo** (Narrativas → detalhe) — segue sendo
  escopo do módulo `propagation-graph` (Sprint 3). ✅ Decisão tomada
  (2026-07-12): construir uma versão simplificada já nesta Sprint 2, sobre
  os campos de relacionamento já capturados por mention (`reply_to`/
  `retweet_of`/`insights_mentioned`), rotulada como amostra das mentions já
  sincronizadas — ver `narratives-exploration.md`.
- **"Ações e decisões"** (detalhe de Narrativa) — ✅ **simplificado
  (2026-07-13)**: `cases` passa a ser dado próprio deste módulo (não mais
  um módulo `command-center` separado, que nunca chegou a ganhar spec além
  desse mesmo requisito — ver [data-model.md](data-model.md)). Ver
  [narratives-exploration.md](narratives-exploration.md), seção "Ações e
  decisões", para as 2 pendências restantes.
- **Autores únicos** e **Sentimento** (2 métricas acima) mudam de "sem
  fonte oficial" para "capturado, com uma limitação documentada" ou
  "resolvido sem ressalva" — nenhuma aproximação amostrada foi aceita em
  lugar nenhum; a premissa de 2026-07-11 ("nunca calcular localmente sobre
  `mentions` amostrada") continua de pé, só a busca por fonte oficial foi
  mais a fundo.

## Rotas/Páginas (sugestão, não fechada)

| Rota | Página |
|---|---|
| `/overview` | Executive Overview |
| `/narratives` | Exploração de Narrativas (lista) |
| `/narratives/[id]` | Detalhe de Narrativa |
| `/sentiment` | Análise de Sentimento |
| `/platforms` | Análise por Plataforma |
| `/themes` | Pautas Eleitorais |

⚠️ DECISÃO PENDENTE: mesma ressalva já registrada em
`executive-overview.md` para `/narratives/[id]` — rota exata (página
própria vs. modal) fica para quando o roteamento geral do app for fechado.

## Referências relacionadas

- [executive-overview.md](executive-overview.md)
- [data-model.md](data-model.md) — `cases` (ex-`command-center`)
- [foundation/data-model.md](../foundation/data-model.md)
- [foundation/narratives.md](../foundation/narratives.md)
- [../aggregated-metrics/overview.md](../aggregated-metrics/overview.md)
- [_index.md](../_index.md) — módulos `intelligence-center`/`propagation-graph`
