---
tipo: feature-spec
módulo: intelligence-center
funcionalidade: executive-overview
status: implementado
atualizado: 2026-07-21
---

# Executive Overview

> ✅ **Segunda leva de ajustes de UI (2026-07-13)**: 5 pedidos do usuário,
> ver `CLAUDE.md`, "UI polish pass" (seção estendida) pra detalhamento
> completo:
> 1. **Tooltips nas colunas da tabela de Narrativas** (`narratives-table.tsx`)
>    — mesmo ícone "?"/componente `Tooltip` já usado nos KPIs, agora também
>    em SOV/Velocidade/Sentimento/Momentum/Risco (cabeçalho de coluna).
>    `Tooltip` ganhou uma prop `position="bottom"` pra esse uso — abrindo
>    pra cima a partir do cabeçalho, o tooltip seria cortado pelo
>    `overflow-x-auto` que envolve a tabela.
> 2. **Legenda (`ScoreLegend`) movida pra logo abaixo da própria tabela** —
>    antes ficava solta no fim da página, depois do painel de Insights,
>    longe dos badges de Risco/Momentum que ela explica.
> 3. **Títulos de widget, rótulos de KPI e cabeçalhos de coluna em negrito**
>    (`font-bold`, eram `font-semibold`/`font-medium`) — `WidgetCard`,
>    `MetricCard`/`SentimentMetricCard`, `NarrativesTable` são todos
>    componentes compartilhados pelas 6 páginas, então o ajuste vale pra
>    todo o módulo, não só esta página.
> 4. **Rótulo de valor no ponto do gráfico de linha, de volta** — tinha sido
>    removido numa revisão anterior (achando que duplicava o painel abaixo
>    do gráfico); o usuário pediu de volta com a mesma frase da primeira
>    vez que pediu. Ver `overview.md`, "Premissas de visualização de
>    dados" regra 2, pra o registro completo — tratado como definitivo,
>    não remover de novo sem confirmar antes.
> 5. Ver `CLAUDE.md` pras 4 regras novas adicionadas a "Cross-cutting UX
>    rules" a partir deste pedido (negrito em título/KPI/coluna, tooltip em
>    coluna de tabela com métrica não-óbvia, legenda de badges sempre junto
>    da tabela, rótulo no ponto do gráfico não removido sem confirmação) —
>    é o pedido explícito do usuário de "documentar para não voltar a
>    acontecer".

> ✅ **Ajustes de UI (2026-07-12, sessão de polish pedida pelo usuário)**:
> 4 mudanças nesta página, nenhuma de backend além de um fix pontual em
> `get_metrics_cards` — ver `CLAUDE.md`, "UI polish pass" pra detalhamento
> completo:
> 1. **Tooltips nos 5 cards de KPI** (`metric-card.tsx`) — ícone "?" com
>    definição simplificada por hover, traduzida a partir da documentação
>    oficial da Brandwatch (`chart-dimensions-and-aggregates`,
>    `mention-metadata-field-definitions`).
> 2. **"Sentimento geral" agora usa `net_sentiment` como %** — o card já lia
>    `net_sentiment` (média ponderada por `total_mentions`, migration
>    `20260714000000`), só a apresentação mudou: valor formatado com `%`
>    (`unit: 'net_sentiment_pct'`) e a variação vs. período anterior deixa
>    de ser % relativa (sem sentido pra um score que cruza zero) e passa a
>    ser diferença absoluta em pontos percentuais ("X p.p."). Fix em
>    `get_metrics_cards`, migration `20260717010000`.
> 3. **Rótulos do gráfico de linha harmonizados** (`trend-line-chart.tsx`)
>    — eixos e rótulo de valor no hover reduzidos (8-9px, peso 600 em vez
>    de 700, halo mais fino), destoavam do resto da página.
> 4. **Tabela de Narrativas movida acima do painel de Insights** — prioriza
>    a tabela acionável; Insights ainda renderiza vazio na maior parte do
>    tempo (depende de `event-radar`/`ai-synthesis`, não implementados).
>
> Mesma sessão também mudou `PageHeaderBar` (compartilhado pelas 6
> páginas, não só esta) — título/subtítulo da página saíram de dentro da
> barra branca de controles (organização/período/filtros) e passaram a
> ficar soltos no canvas cinza abaixo dela, maiores (`text-2xl`/`text-3xl`),
> igual ao protótipo real — ver `overview.md` e `CLAUDE.md`.

> ✅ **Implementado (2026-07-15, ajustes 2026-07-12)**: `/overview`
> (`app/(intelligence-center)/(analytics)/overview/page.tsx`) consome o
> envelope de `get-page-overview` via `usePageEnvelope` — nenhum cálculo no
> frontend, só renderização (Princípio técnico 2), como a spec pede. Cobre
> quase tudo desta spec como descrito:
> - **Header global** (`components/intelligence-center/page-header-bar.tsx`)
>   — seletor de organização (só aparece com >1 organização), os 4 modos de
>   período (Diário/Semanal/Mensal/Personalizado, com popover de 2 datas
>   pré-preenchido e validação `start <= end`), painel de "Filtros
>   avançados" presentacional (9 chips, sem `onClick` — ver nota da própria
>   spec sobre não inventar filtragem que o backend não resolve). Sem
>   seletor de Query, como decidido.
> - **5 cards de KPI** (`components/intelligence-center/metric-card.tsx`)
>   — Total de menções/Sentimento geral/Autores únicos/Alcance
>   estimado/Engajamento total, cada um com delta vs. período anterior já
>   calculado pelo backend (`get_metrics_cards`).
> - **Gráfico de volume por sentimento** (`charts/trend-line-chart.tsx`) e
>   **tabela de Narrativas** (`narratives-table.tsx`, 7 colunas, ordenação
>   default do backend por `risk_score` desc/`total_mentions` desc,
>   reordenável por clique no cabeçalho, badges/barras de
>   Sentimento/Velocidade/Momentum/Risco com banda+cor) — ambos exatamente
>   como especificado abaixo.
> - **Estados de loading/erro/vazio por widget** (`WidgetCard`,
>   `<EmptyState />`) — cada card busca independentemente, um erro não
>   derruba os outros.
>
> ⚠️ **Gap real, não implementado**: o card de **Share of Voice por Query
> Group** ("Fluxo principal" item 4 e "Cards de topo" abaixo) nunca foi
> construído — `get_metrics_cards` (`aggregated-metrics/sql-aggregation.md`)
> só retorna os 5 KPIs de `bw_query_metrics_daily`
> (`total_mentions`/`sentiment_*`/`reach_estimate`/`engagement_score`/
> `unique_authors`); não existe function SQL nem bloco de envelope para SOV
> agregado por Query Group. Não é uma decisão revertida, é uma lacuna que
> passou despercebida entre esta spec e `sql-aggregation.md` — registrada
> como gap técnico #22 em `_pending.md`.
>
> Deviação menor: a página também renderiza um painel de "Insights"
> (`NarrativeTextPanel`/`HighlightsPanel`) acima da tabela de Narrativas —
> não descrito nesta spec, vem do bloco `highlights`/`narrative_text` do
> envelope (`block-mapping-per-page.md` já previa `overview` com esses
> blocos). Hoje renderiza sempre vazio/"não disponível ainda", já que
> `get_active_highlights` e a síntese de IA ainda não existem (gaps #7/#8
> em `_pending.md`) — nenhum dado inventado, só o estado "ainda não
> disponível".
>
> Passes de correção pós-implementação, sem mudança de comportamento desta
> spec: revisão de paridade com o protótipo real (2026-07-12 — breakpoint
> `900px`, rail colapsado, grids `md:` no tablet) e ajustes de UI a partir
> de screenshot review (2026-07-12 — sentimento virou barra cumulativa em
> vez de donut, linha do gráfico ganhou rótulo de valor no hover, sidebar
> `sticky`/`min-h-screen` para não terminar antes do fim do conteúdo) — ver
> `CLAUDE.md`, "Prototype-parity pass" e "Follow-up UI fixes" para o
> detalhamento completo (afetam as 5 páginas de `intelligence-center`, não
> só esta).
>
> Verificação: `npm run build` (typecheck + lint + rotas) passa limpo; sem
> automação de browser disponível neste ambiente, então o carregamento
> real dos widgets contra dados autenticados não foi verificado
> visualmente (mesma limitação já registrada em `CLAUDE.md` para toda a
> leva de `intelligence-center`).

> ✅ **Movida de `foundation/executive-overview.md` para cá (2026-07-12)** —
> era a única página de UI especificada dentro de um módulo que, por
> definição (`foundation/overview.md`), é só backend ("Sprint 1 é
> inteiramente a integração com a Brandwatch... nenhuma UI"). Isso divergia
> da tabela de rotas de `aggregated-metrics/overview.md`, que já listava
> `/overview` como página de `intelligence-center` como as demais. Esta
> spec passa a ser a primeira funcionalidade de `intelligence-center`
> (entrada do app pós-login), e o mapeamento de colunas da "Tabela
> interativa de Narrativas" (antes em `foundation/overview.md`) foi
> incorporado abaixo — deixa de depender de um documento de outro módulo
> para a UI se descrever por completo. `foundation` continua dono só dos
> dados que esta tela lê (`bw_query_metrics_daily`, `narratives`/
> `narrative_metrics`, `reporting.narratives_overview`), sem mudança de
> schema — ver [../foundation/data-model.md](../foundation/data-model.md).

## Objetivo

Dar ao usuário, logo após o login, uma visão executiva do que está
acontecendo: volume/sentimento ao longo do tempo, Share of Voice, e uma
tabela interativa priorizando as Narrativas que merecem atenção agora.

## Usuários afetados

Qualquer usuário autenticado, membro de ao menos uma organização (ver
`organization_members` em [../foundation/data-model.md](../foundation/data-model.md)).

## Fluxo principal

1. Usuário autenticado acessa `/overview`.
2. A página resolve a(s) organização(ões) do usuário (via
   `auth_organization_ids()`/RLS) — se pertencer a mais de uma, um seletor de
   organização é exibido. ✅ **Resolvido (2026-07-13)**: ao trocar de
   organização, **toda** a aplicação (não só esta tela) passa a mostrar
   só os indicadores daquela organização — já garantido pela RLS
   (`auth_organization_ids()`), o seletor só troca qual é a "ativa" na
   sessão do frontend (Princípio técnico 2, sem lógica de acesso no
   client).
3. ✅ **Resolvido (2026-07-13), corrige a versão anterior desta seção**:
   "uma organização está vinculada a 1 ou mais Queries" — verdade (já era
   o desenho de dados desde `foundation`, "1 Project por organização",
   `brandwatch-setup.md`, com N Queries dentro desse Project), **mas
   Queries são um detalhe técnico, nunca expostas ao usuário final** —
   pedido explícito do usuário: "o seletor de organização é independente
   de Query... as queries devem ser transparentes para o usuário final,
   ele só entende organização". **Não existe seletor de Query.** Quando
   uma organização tem mais de uma Query, os dados de **todas** elas são
   combinados automaticamente na visão da organização — o usuário nunca
   escolhe uma Query, nem sabe que existe mais de uma. O vínculo
   organização↔Queries é resolvido no cadastro/configuração da
   organização (hoje via `BRANDWATCH_QUERY_IDS`/bootstrap de `foundation`,
   ver `foundation/overview.md`; uma futura tela de gestão de organizações
   herdaria o mesmo modelo), nunca pelo usuário final em tempo de uso.
4. Carrega, para a organização ativa e o período selecionado (default: 7
   dias), **combinando todas as Queries da organização**:
   - Série temporal de volume por sentimento, de `bw_query_metrics_daily`
     — somado entre as Queries da organização.
   - Share of Voice por Query Group (se alguma Query da organização
     pertencer a um) — card mostra a comparação nativa do grupo (candidato
     vs. concorrentes); se a organização tiver mais de uma Query em Query
     Groups diferentes, mostra um card por grupo.
   - Contagem total de mentions do período — soma de `total_mentions` de
     todas as Queries da organização.
   - Tabela interativa de Narrativas — **todas** as Narrativas de
     **todas** as Queries da organização, numa lista só. Cada linha
     calcula seu SOV relativo à própria Query de origem (`narrative_metrics.query_id`,
     nunca misturado com o total de outra Query — mesma correção do bug de
     2026-07-11, ver `foundation/data-model.md`, "Camada de reporting")
     — o usuário só vê "as narrativas da minha organização", sem
     perceber que o SOV de cada uma é calculado dentro do universo da sua
     própria Query. ✅ **Revertido (2026-07-20)**, pedido do usuário: "tanto
     na página de overview quanto na lista de narrativas serão mostradas
     todas as narrativas" — esta tabela volta a mostrar **todas** as
     Narrativas (Category de topo e Subcategory juntas), substituindo a
     decisão de 2026-07-16 abaixo. Viabilizado pela troca simultânea do
     título da Narrativa pra `"Categoria - Subcategoria"` (ver
     `foundation/narratives.md`), que desambigua uma Subcategory mesmo
     listada ao lado de outras Pautas na mesma tabela. Implementado via
     `get_narratives_table(p_scope => null)`, ver
     `aggregated-metrics/sql-aggregation.md`. Categories/Subcategories com
     `status = 'inactive'` (removidas da Brandwatch, ver
     `foundation/data-model.md`) continuam nunca aparecendo aqui.
     > Histórico (2026-07-16, não mais em vigor nesta página): quando uma
     > Category tinha Subcategories (a maioria — Brandwatch exige ≥1
     > Subcategory por Category, ver `brandwatch-setup.md` §5), esta tabela
     > mostrava só a Category de topo (`p_scope => 'roots'`), pra evitar
     > listar Pauta + suas Narrativas-filhas juntas — a mesma preocupação
     > que motivou isso é resolvida agora pelo título composto em vez de
     > por filtro de granularidade.
5. Usuário pode clicar "Ver" numa linha da tabela de Narrativas → navega
   para o detalhe (`/narratives/[id]`, ver
   [narratives-exploration.md](narratives-exploration.md)).

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Usuário sem nenhuma organização em `organization_members` | Tela de estado vazio: "Você ainda não tem acesso a nenhuma organização" — sem crash, sem redirecionar para login (sessão é válida, só falta associação) |
| Organização sem nenhuma `bw_queries` cadastrada | Mesmo estado vazio acima ("Nenhum dado sincronizado ainda") |
| Organização sem nenhum `bw_project`/sync ainda rodado | `<EmptyState />` no gráfico de volume: "Nenhum dado sincronizado ainda" |
| Nenhuma Narrativa cadastrada | `<EmptyState />` na tabela: "Nenhuma Narrativa em monitoramento" |
| Falha ao carregar (erro de rede/Supabase) | `<ErrorMessage retry />` por widget — um widget falhar não derruba os outros (cada card busca seus dados independentemente) |
| Narrativa sem linha em `narrative_metrics` para o dia selecionado, **ou** com `narrative_metrics.query_id` nulo (Category sem Query associada, ou associada a mais de uma — ver `../foundation/data-model.md` "Camada de reporting", correção 2026-07-11) | Linha aparece na tabela com SOV/Tendência/Sentimento/Momentum vazios ("—"), não some da lista (Risco e Narrativa continuam vindo de `narratives`, que sempre existe) |

> ✅ **Cards de topo revalidados contra o protótipo de frontend (2026-07-12,
> "Comunicação Inteligente" — claude.ai/design)**: o protótipo desenha 5
> cards (Total de menções, Sentimento geral, Autores únicos, Alcance
> estimado, Engajamento total). Todos os 5 têm agora agregado oficial —
> `total_mentions`, `sentiment_positive/neutral/negative`, `reach_estimate`,
> `engagement_score`, **e `unique_authors`** (todos em
> `bw_query_metrics_daily`, `category_id is null`). "Autores únicos" tinha
> sido descartado nesta mesma revisão por não ter fonte oficial confirmada
> (`unique_authors` já existiu em `narrative_metrics` e foi removido em
> `20260711010000` por ser contagem local sobre `mentions` amostrada) — 
> **corrigido em seguida no mesmo dia** (pedido do usuário: "Autores únicos
> já existe na brandwatch, precisamos rever o que estamos capturando por
> API"): o aggregate de chart `authors` ("distinct authors who posted",
> confirmado em `chart-dimensions-and-aggregates`) é, sim, oficial e não
> amostrado — mesma família que já sustenta `reachEstimate`/
> `engagementScore`. Ver `../foundation/data-model.md`, `unique_authors`, e
> migration `20260712020000`. A mesma revisão também corrigiu um gap real
> encontrado nesse processo: `reach_estimate`/`engagement_score` **nunca
> tinham sido populados** para a linha `category_id is null` (a que estes
> cards leem) — `syncCategoryDailyAggregate()` só cobre a dimensão
> `categories`, que nunca inclui a Query inteira.

> ✅ **"Sentimento geral" corrigido para a distribuição positivo/neutro/
> negativo que esta spec sempre pediu (2026-07-13)** — a nota de
> 2026-07-12 acima ("`net_sentiment` como %") tinha implementado o card
> como um único score -100..100 formatado com `%` — uma divergência real
> desta spec, que desde a primeira versão descreve o card como "Sentimento
> geral (**distribuição positivo/neutro/negativo compacta**)" (ver "Cards
> de topo" abaixo). Achado pelo usuário direto na tela: um valor isolado
> como "-1" não comunica nada sem a escala -100..100 por perto, e a
> variação "↑ 15,1%" ao lado de um score que ficou mais negativo lia como
> contraditória. Corrigido sem nenhuma chamada nova à Brandwatch nem
> function SQL nova: `SentimentMetricCard`
> (`components/intelligence-center/metric-card.tsx`) substitui `MetricCard`
> só para `metric.key === 'net_sentiment'`, reaproveitando exatamente os
> mesmos 3 percentuais já buscados para o widget "Sentimento geral" logo
> abaixo (bloco `breakdowns`, `type = 'sentiment'` — `get_sentiment_breakdown`,
> ver `aggregated-metrics/sql-aggregation.md`), só numa apresentação
> compacta o bastante pra um card de KPI. `get_metrics_cards` continua sem
> mudança — o score `net_sentiment` bruto que ele calcula segue disponível
> no envelope (`metrics`), só não é mais o que este card específico
> renderiza. Deviação preservada, não revertida: o widget "Sentimento
> geral" abaixo da grade (`SentimentBar`) mostra a mesma informação numa
> versão maior — redundância aceita deliberadamente (ver `CLAUDE.md`,
> entrada desta data) em vez de reestruturar o layout da página, que não
> fazia parte do pedido.

> ✅ **Redundância revertida — o frame ao lado do gráfico virou "O que os
> gráficos mostram?" (2026-07-21)** — pedido do usuário: "Na página
> overview o Sentimento geral está tanto na KPI quanto em um frame ao lado
> do gráfico de linhas, portanto, substitua o frame ao lado do gráfico pelo
> frame que 'O que os gráficos mostram?'". A redundância aceita em
> 2026-07-13 (nota acima) deixa de ser aceita — o widget "Sentimento
> geral" (`BreakdownPanel`/`SentimentBar`) ao lado de "Volume e sentimento
> ao longo do tempo" foi removido; nesse lugar entra
> `NarrativeTextPanel`/`narrative_text` (protótipo original "O que os
> gráficos mostram?"), que antes só existia numa caixa própria mais abaixo
> na página — não há mais 2 cópias dele, só a nova posição. Nenhuma mudança
> de backend/envelope — mesmo dado (`envelope.narrative_text`), só
> reposicionado (`app/(intelligence-center)/(analytics)/overview/page.tsx`).

## Interface (UI)

- **Header**: nome da organização ativa (+ seletor, se aplicável), seletor
  de período. **Sem seletor de Query** — pedido explícito
  do usuário (2026-07-13): "o seletor de organização é independente de
  Query... as queries devem ser transparentes para o usuário final, ele
  só entende organização". ✅ Confirmado (2026-07-12): a organização
  selecionada **restringe o acesso aos dados** de toda a aplicação, não só
  desta tela — já garantido pela RLS via `auth_organization_ids()`
  (`organizations`/`organization_members`, ver
  [../foundation/data-model.md](../foundation/data-model.md)); o seletor
  troca qual organização é "ativa" na sessão do frontend, a aplicação de
  acesso em si já é backend (Princípio técnico 2).
- Este header (organização + período) é **global** — os mesmos 2
  seletores persistem entre `/overview` e as demais páginas de
  `intelligence-center` (ver [overview.md](overview.md)), especificado uma
  vez aqui, não redescrito por página.

  ✅ **Seletor de período reformulado (2026-07-15, substitui "7/14/30
  dias")** — pedido do usuário a partir do protótipo real (4 botões
  "Diário/Semanal/Mensal/Personalizado" + um indicador de intervalo tipo
  "06/05/2024 – 12/05/2024" quando "Personalizado" está ativo). Mapeamento
  para `period.start`/`period.end` (que o envelope já aceita como
  intervalo de datas arbitrário, `aggregated-metrics/sql-aggregation.md` —
  nenhuma mudança de backend necessária):

  | Botão | Intervalo | Observação |
  |---|---|---|
  | Diário | 1 dia (hoje, fuso do usuário) | ⚠️ **Suposição, não confirmada contra o protótipo real**: "hoje" corrido, não uma janela de 24h — mesma disciplina de fuso de `lib/date/format.ts`. ✅ **Resolvido (2026-07-19)**: `get_volume_trend` usa grão horário (`bw_query_metrics_hourly`) nesse modo — o gráfico de evolução mostra uma série real, não mais 1 ponto único (ver bullet "Gráfico" abaixo). ⚠️ **Gap distinto ainda aberto (2026-07-21)**: 3 dos 5 cards de topo (Autores únicos/Alcance estimado/Engajamento total) podem mostrar "Ainda sincronizando…" nesse modo — não é falta de grão, é o dia corrente ainda não ter recebido essas 3 métricas específicas de `bw-sync` (ver bullet "Cards de topo" abaixo) |
  | Semanal | 7 dias corridos terminando hoje | Equivalente ao antigo botão "7 dias" |
  | Mensal | 30 dias corridos terminando hoje | Equivalente ao antigo botão "30 dias"; o antigo "14 dias" foi **removido** — não existe no protótipo |
  | Personalizado | `start`/`end` escolhidos pelo usuário via 2 campos de data | Sem limite mínimo/máximo de intervalo definido — ⚠️ revisitar se o backend precisar de um teto (ex: performance de `get_volume_trend` num intervalo de anos) |

  Trocar de botão preset recalcula `start`/`end` automaticamente; abrir o
  seletor "Personalizado" preenche os 2 campos com o intervalo atualmente
  ativo (não começa vazio). `period.comparison` continua sempre
  `"previous_period"` nos 4 modos — mesma duração, janela imediatamente
  anterior — nenhuma mudança nessa regra.
- **Cards de topo**: Total de menções, Sentimento geral (distribuição
  positivo/neutro/negativo compacta), Autores únicos, Alcance estimado,
  Engajamento total — todos de `bw_query_metrics_daily` (`category_id is
  null`), **somados entre todas as Queries da organização** (ver "Fluxo
  principal" acima), cada um com variação vs. período anterior. Share of
  Voice (se alguma Query da organização pertencer a um Query Group) —
  `<EmptyState />` textual se não houver Query Group, não esconder o card.
  ✅ **"Ainda sincronizando…" no lugar de um 0 falso no modo "Diário"
  (2026-07-21)** — pedido do usuário: "Valores nulos em Autores únicos,
  Alcance estimado e engajamento total quando o período Diário é
  selecionado." Autores únicos/Alcance estimado/Engajamento total só
  chegam em `bw_query_metrics_daily` por chamadas que rodam depois do loop
  de sentimento dentro da fase `daily_metrics` de `bw-sync` — pra um
  período de 7/30 dias um único dia pendente é mascarado pela soma dos
  demais, mas no modo "Diário" (1 dia = hoje) essas 3 métricas podiam
  ficar presas em `0` (dado ainda não sincronizado, não um "sem
  atividade") até a próxima invocação alcançar essa chamada. `MetricCard`
  agora mostra "—"/"Ainda sincronizando…" nesse caso, nunca um `0`/queda
  de -100% enganosos — ver `aggregated-metrics/sql-aggregation.md`
  (`get_metrics_cards`) e `CLAUDE.md` para o detalhamento completo. Total
  de menções/Sentimento geral não são afetados (populados pela mesma
  chamada, que sempre roda primeiro nessa fase).
- **Gráfico**: série temporal de volume por sentimento (linhas/área
  empilhada), timezone fixo `America/Sao_Paulo`. ✅ **Grão horário no modo
  "Diário" (2026-07-19)** — `get_volume_trend` (ver
  `aggregated-metrics/sql-aggregation.md`) muda automaticamente pra
  `bw_query_metrics_hourly` quando o período selecionado é exatamente 1
  dia; sem isso, o modo "Diário" caía no mesmo grão `day` das janelas
  curtas e devolvia um único ponto (o dia inteiro), inútil como série
  temporal. Nenhuma mudança de parâmetro no frontend — é automático a
  partir da duração do período já enviado. ✅ **Rótulos +3pt (2026-07-21)**
  — pedido do usuário, eixo 10px→13px e rótulo de valor no ponto (hover)
  9px→12px (`trend-line-chart.tsx`, `AXIS_FONT_SIZE` e o `<text>` de
  hover) — deixa de ser "texto recessivo" abaixo do resto da página
  (12px) de propósito, é um ajuste explícito, não uma nova escolha de
  hierarquia visual.
- **Tabela interativa de Narrativas** (ver imagem de referência do usuário):
  uma linha por Narrativa ativa **de qualquer Query da organização** —
  lista única, sem agrupar/expor de qual Query cada uma vem (ver "Fluxo
  principal" acima sobre como o SOV de cada linha continua correto mesmo
  assim). Nenhum número é armazenado
  duplicado — os 4 campos brutos (`sov_percent`, `net_sentiment`,
  `total_mentions` etc.) vêm de `reporting.narratives_overview`
  (`foundation/data-model.md`); os 3 scores derivados
  (Momentum/Velocidade/Risco) são calculados por
  `get_narratives_table()` (`aggregated-metrics/sql-aggregation.md`, seção
  "Scores de Narrativa") — nenhum cálculo acontece no frontend, ele só
  renderiza valor+banda+cor que o envelope já traz prontos.

  ✅ **7 colunas (2026-07-13, substitui a versão anterior de 5 colunas)** —
  resolve as 2 ⚠️ DECISÃO PENDENTE que existiam pra Sentimento/Momentum, e
  adiciona Velocidade (separada de Momentum, recomendação do usuário — ver
  `sql-aggregation.md`) e Risco como score (antes só `risk_level` manual):

  | Coluna | Fonte | Valor exibido |
  |---|---|---|
  | Narrativa | `narratives.title` | direto |
  | SOV | `reporting.narratives_overview.sov_percent` | % — Share of Voice (Narrativa), ver `_glossary.md` |
  | Velocidade | `get_narratives_table().velocity_score` | score 0-100 + seta/rótulo (5 faixas — ver tabela abaixo). Crescimento recente (dia atual vs. anterior), **independente** do período selecionado no header |
  | Sentimento | `reporting.narratives_overview.net_sentiment` | score -100 a +100 + rótulo/cor (7 faixas — ver tabela abaixo) |
  | Momentum | `get_narratives_table().momentum_score` | score 0-100 (5 faixas — ver tabela abaixo). Força/relevância atual (volume+engajamento+autores+alcance), comparando o período selecionado no header contra o período anterior de igual duração |
  | Risco | `get_narratives_table().risk_score` | score 0-100 + rótulo/cor (4 faixas — ver tabela abaixo) |
  | Ação | — | link "Ver" → `/narratives/[id]` (ver [narratives-exploration.md](narratives-exploration.md)) |

  **Bandas e cores** (mapeamento exato de cor em
  [_design-tokens.md](../_design-tokens.md)):

  | Sentimento (score) | Rótulo | Cor |
  |---:|---|---|
  | ≥ +50 | Muito positivo | verde escuro |
  | +20 a +49 | Positivo | verde |
  | +5 a +19 | Levemente positivo | verde claro |
  | -4 a +4 | Neutro | cinza |
  | -5 a -19 | Levemente negativo | amarelo |
  | -20 a -49 | Negativo | vermelho |
  | ≤ -50 | Muito negativo | vermelho escuro |

  | Momentum (score) | Situação |
  |---:|---|
  | 0–19 | Muito baixo |
  | 20–39 | Baixo |
  | 40–59 | Moderado |
  | 60–79 | Alto |
  | 80–100 | Explosivo |

  | Velocidade (score) | Rótulo |
  |---:|---|
  | 0–19 | ↓ Encolhendo rapidamente |
  | 20–39 | ↘ Diminuindo |
  | 40–59 | → Estável |
  | 60–79 | ↑ Crescendo |
  | 80–100 | ↗ Viralizando |

  | Risco (score) | Situação | Cor |
  |---:|---|---|
  | 0–33 | Baixo | verde |
  | 34–59 | Moderado | amarelo |
  | 60–84 | Alto | laranja |
  | 85–100 | Crítico | vermelho |

  `narratives.risk_level` (enum manual `low`/`medium`/`high`/`critical`)
  continua no schema mas **não é mais** o que esta coluna mostra — vira um
  override manual opcional, sem UI própria ainda (ver `sql-aggregation.md`,
  "Scores de Narrativa"). `period` do header (7/14/30 dias) é o que
  Momentum usa como período atual/anterior — Velocidade **não** usa esse
  filtro, é sempre curto prazo (ver `sql-aggregation.md`).

  - Sentimento e Risco renderizados como *dot*/badge colorido, Momentum e
    Velocidade como barra de progresso + valor numérico (ex: `██████░░░░ 61`)
    — mapeamento exato de cor em
    [_design-tokens.md](../_design-tokens.md).
  - Ordenação default: por `risk_score` desc, depois `total_mentions` desc
    — ✅ confirmado (2026-07-12): "esse é o padrão visual, podendo o
    usuário ordenar por outras opções" — controle de ordenação padrão de
    tabela (clique no cabeçalho da coluna), sem regra de negócio própria
    além da ordenação default acima.
- **Estados**: `<Spinner />` (loading), `<ErrorMessage retry />` (erro),
  `<EmptyState />` (vazio) — por widget, conforme skill `web-app-structure`
  (`references/frontend.md`).

## Regras de negócio

- Nenhum número de volume/sentimento/SOV é recalculado no frontend a partir
  de `mentions` — tudo vem pré-calculado de `bw_query_metrics_daily`/
  `narrative_metrics`/`reporting.narratives_overview` (Princípio técnico 2,
  `_index.md`: sem lógica de negócio no frontend).
- ✅ **Resolvido (2026-07-13)**: Sentimento/Momentum/Velocidade/Risco da
  tabela de Narrativas usam as fórmulas e faixas definitivas em
  [../aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md),
  "Scores de Narrativa" — deixaram de ser placeholder. O frontend
  continua **só renderizando** o que o envelope devolver (score + banda +
  cor), sem calcular ou hard-codar threshold no cliente (Princípio técnico
  2) — as tabelas de faixas acima (nesta spec) são pra referência de
  design, a fonte de verdade do cálculo é `sql-aggregation.md`.
- Nesta página o dado chega via o envelope de `aggregated-metrics`
  (`get-page-overview`, bloco `narratives` + `metrics` + `trends`, ver
  [../aggregated-metrics/overview.md](../aggregated-metrics/overview.md))
  — não uma consulta direta do frontend a `reporting.narratives_overview`/
  `bw_query_metrics_daily`. Reusa a mesma function SQL
  (`get_narratives_table`) que a página Narrativas e a seção "narrativas
  dentro da pauta" de Pautas Eleitorais, ver
  [../aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md).

## Dados envolvidos

- **Lê** (via o envelope de `aggregated-metrics`, não consulta direta):
  `bw_query_metrics_daily`, `narratives`, `narrative_metrics`,
  `reporting.narratives_overview`, `organization_members` (para resolver
  organizações do usuário), `bw_queries` (server-side, pra resolver todas
  as Queries da organização — nunca exposto como seletor ao usuário).
- Nenhuma escrita nesta tela.
- Detalhes: [../foundation/data-model.md](../foundation/data-model.md).

## Permissões

| Ação | Quem pode |
|---|---|
| Acessar `/overview` | qualquer usuário autenticado com ao menos 1 `organization_members` |
| Ver dados de uma organização | só membros dela (RLS) — inclui automaticamente todas as Queries daquela organização, sem controle de acesso por Query individual |

## Notificações / Feedback

Sem toasts nesta tela (é só leitura) — erros são inline por widget (ver
Fluxos alternativos acima).

## Dependências técnicas

- Edge Function `get-page-overview` (ver
  [../aggregated-metrics/edge-functions-per-page.md](../aggregated-metrics/edge-functions-per-page.md))
  — o frontend consome o envelope, não monta a query.
- `auth_organization_ids()`/RLS para resolver organização(ões) do usuário.

## Referências relacionadas

- [overview.md](overview.md) — módulo `intelligence-center`.
- [narratives-exploration.md](narratives-exploration.md)
- [../foundation/data-model.md](../foundation/data-model.md)
- [../foundation/narratives.md](../foundation/narratives.md)
- [../aggregated-metrics/overview.md](../aggregated-metrics/overview.md)
- [../aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md) — "Scores de Narrativa" (Sentimento/Momentum/Velocidade/Risco)
- [../_design-tokens.md](../_design-tokens.md)
