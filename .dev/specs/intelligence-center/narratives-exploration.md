---
tipo: feature-spec
módulo: intelligence-center
funcionalidade: narratives-exploration
status: pronto
atualizado: 2026-07-25
---

# Exploração de Narrativas (lista + detalhe)

> ✅ **Lista reestruturada (2026-07-14)**, pedido do usuário, 5 itens:
> 1. **Coluna "Ação" removida** de `NarrativesTable` (agora 6 colunas:
>    Narrativa/SOV/Tendência/Sentimento/Momentum/Risco) — "não está sendo
>    usual, pois ao clicar no nome abre o modal e na linha destaca o
>    card." O título já é o link/gatilho de navegação; a coluna extra
>    duplicava essa mesma ação.
> 2. **Painel de resumo passou de "abaixo da tabela" para "ao lado dela"**:
>    selecionar uma linha agora divide a tela num grid de 2 colunas —
>    tabela encolhe à esquerda (`minmax(0,1fr)`), `NarrativeCard` completo
>    aparece à direita numa coluna fixa de 400px — "de forma que o resumo
>    executivo possa ser lido completamente" (antes o card aparecia numa
>    largura reduzida, `sm:max-w-md`, empilhado abaixo da tabela).
> 3. **Desseleção**: clicar de novo na mesma linha já selecionada
>    desmarca-a (mesmo `onRowClick`, alterna); um botão "✕ Fechar" acima
>    do card oferece a mesma ação de forma explícita/descobrível. Qualquer
>    um dos dois volta a visualização padrão (tabela cheia + grade de
>    cards por categoria).
> 4. **Tabela dinâmica**: toggle "Subcategorias"/"Categoria e subcategoria"
>    no cabeçalho do widget da tabela (`NarrativesTable`'s novo prop
>    `groupByCategory`) — "Subcategorias" é o comportamento de sempre
>    (lista plana); "Categoria e subcategoria" agrupa as linhas por
>    `category_label` (a mesma Category-pai que já agrupa a grade de cards,
>    `NarrativeCategoryLanes`, desde 2026-07-25), com cabeçalho de grupo
>    expansível/recolhível — mesmo padrão visual (▲/▼) já usado pelas raias
>    de cards.
> 5. **Toggle "Tabela e cards"/"Só tabela"/"Só cards"**: controla quais dos
>    2 blocos (tabela interativa, grade de cards por categoria) aparecem na
>    página. Em "Só tabela", o item 2 acima (painel lateral ao selecionar)
>    é o único jeito de ler o resumo completo de uma Narrativa sem a grade
>    de cards — por isso o pedido do usuário marcou esse item como
>    "primordial" nesse modo. Em "Só cards", a tabela (e a seleção que
>    depende dela) fica oculta; a grade por categoria aparece
>    incondicionalmente.
>
> Ver `CLAUDE.md` para o detalhamento completo da implementação.

> Cobre "Página 2 — Narrativas" e "8. Página de detalhamento da narrativa" do
> documento de estrutura do protótipo. É a única página, além da Visão
> Geral, que o protótipo `Comunicacao Inteligente.dc.html` implementa de
> ponta a ponta (estados `isNarrativesPage`/`isDetailPage` no componente) —
> as demais telas deste módulo (Sentimento, Plataformas, Pautas) existem só
> como texto no documento de estrutura, sem protótipo interativo
> correspondente.

## Objetivo

Permitir que o usuário explore todas as Narrativas em monitoramento (não só
as priorizadas do Executive Overview), veja um resumo rápido ao selecionar
uma linha da tabela, e abra um detalhe completo por Narrativa: evolução,
formação/propagação, principais disseminadores, menções relevantes e
histórico de ações.

## Usuários afetados

Mesmo público de `executive-overview.md` — qualquer usuário autenticado
membro de ao menos uma organização.

## Fluxo principal

1. Usuário acessa `/narratives` (ou navega a partir de "Ver" na tabela do
   Executive Overview).
2. Tabela com **todas** as Narrativas da organização ativa (header
   global, ver [executive-overview.md](executive-overview.md), "Header" —
   combina todas as Queries da organização, transparente ao usuário) —
   mesmas 6 colunas do Executive Overview: Narrativa, SOV, Tendência,
   Sentimento, Momentum, Risco (coluna "Ação" removida em 2026-07-14, ver
   blockquote de topo) — ordenação personalizada (ver
   [executive-overview.md](executive-overview.md), "Tabela interativa de
   Narrativas", já especificada lá; esta página reusa o mesmo componente,
   sem duplicar regra), com um toggle "Subcategorias"/"Categoria e
   subcategoria" (2026-07-14) que agrupa as linhas por `category_label`
   quando ativado (ver "Interface (UI)" abaixo). ✅ **Simplificado
   (2026-07-21)**, pedido do usuário:
   "Para facilitar vamos considerar apenas as subcategorias em todas as
   narrativas. Retire a regra de 'categoria - subcategoria'." Esta página
   (e o Executive Overview) voltam a listar só as Narrativas-folha
   (Subcategory) — `get_narratives_table(p_scope => 'leaves')` — nunca mais
   a Category raiz junto na mesma tabela. O título da Narrativa também
   voltou a ser só o nome da própria Subcategory (o prefixo "Categoria -"
   de 2026-07-20 deixou de ser necessário, já que a Category raiz nunca
   mais aparece misturada na mesma lista). Narrativas cuja Category está
   `status = 'inactive'` (removida da Brandwatch) continuam não aparecendo.
   > Histórico (2026-07-20, revertido no dia seguinte): esta página tinha
   > passado a listar Category de topo e Subcategory juntas
   > (`p_scope => null`), viabilizado por um título composto
   > "Categoria - Subcategoria" pra desambiguar. Histórico (2026-07-16,
   > mesmo comportamento do estado atual): "a granularidade mais
   > específica, as narrativas dentro de cada categoria" — `p_scope =>
   > 'leaves'`.
3. Clique numa linha → painel de resumo sem navegar de página (nome,
   resumo, indicadores-chave, mix de plataformas) — equivalente ao estado
   `hasSelection` do protótipo. ✅ **Layout lado a lado (2026-07-14)**: o
   painel deixou de aparecer abaixo da tabela (largura reduzida,
   `sm:max-w-md`) e passou a aparecer **ao lado** dela — a tabela encolhe
   pra uma coluna `minmax(0,1fr)`, o painel (`NarrativeCard` completo)
   ocupa uma coluna fixa de 400px à direita, permitindo ler o resumo
   executivo por inteiro. Clicar de novo na mesma linha, ou o botão
   "✕ Fechar" acima do card, desseleciona e volta à visualização padrão.
4. Nenhuma linha selecionada (e o modo de exibição inclui cards, ver
   blockquote de topo) → grid de cards, um por Narrativa (nome,
   resumo, SOV, momentum, tendência, botão "Explorar narrativa") —
   equivalente a `hasNoSelection`/`narrativeCards` no protótipo. (Nota: o
   `NarrativeCard` implementado, ver `sql-aggregation.md` "Campos do card
   de Narrativa", não mostra um badge de Tendência dedicado hoje — mostra
   Risco+Momentum no cabeçalho — mesma divergência de card/spec já
   registrada antes da troca Velocidade→Tendência, não introduzida por
   ela.) ✅ **Agrupado por categoria (2026-07-25)**: pedido do usuário
   ("os cards que ficam abaixo, devem ser organizados pela categoria")
   — os cards deixam de ser uma grade única e passam a ser organizados em
   uma "raia" por Category-pai (`NarrativeCategoryLanes`, ver "Interface
   (UI)" abaixo).
5. "Ver página completa" (no painel de resumo) ou "Explorar narrativa" (no
   card) → abre o detalhe. ✅ **Decidido (2026-07-12), implementado
   (2026-07-22)**: modal sobre a lista (mantém contexto/filtros da lista,
   evita recarregar a página inteira para um conteúdo tão rico) — via
   **intercepting route** do Next.js App Router
   (`app/(intelligence-center)/(analytics)/@modal/(.)narratives/[id]/page.tsx`
   sobre `/narratives/[id]` "cheio"): navegar a partir de **qualquer**
   página dentro de `(analytics)` (não só `/narratives` — Overview,
   Plataformas e Pautas também linkam pra `/narratives/[id]` via
   `NarrativesTable`/`NarrativeCard`) abre como modal por cima da tela
   atual; acessar `/narratives/[id]` direto (link compartilhado, recarregar
   a página) continua renderizando a página completa, sem modal — a
   interceptação do Next.js só se aplica a navegação client-side, nunca a
   um carregamento "duro" da URL. Um único componente de detalhe
   (`components/intelligence-center/narrative-detail-content.tsx`) serve os
   dois casos — não duplica UI; o modal (`narrative-detail-modal.tsx`)
   também expõe um link "Abrir página completa" (`<a>` nativo, força
   navegação dura pra escapar da interceptação), pra quem quiser a URL
   compartilhável fora do modal.
6. Detalhe da Narrativa: resumo executivo, evolução (narrativa vs. volume
   geral), formação e propagação (texto + disseminadores), grafo de
   disseminação simplificado, menções relevantes, ações e decisões.

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Nenhuma Narrativa cadastrada | `<EmptyState />`, mesma mensagem de `executive-overview.md` |
| Narrativa sem `bw_category_id` (só `narrative_signals`) | Não aparece em `narrative_metrics` (ver `foundation/data-model.md`) — linha/card mostra "—" nos campos de métrica, mas continua navegável (Risco/Narrativa sempre vêm de `narratives`) |
| Narrativa sem nenhuma linha em `bw_query_top_authors`/`bw_query_topics` para a Category (sync ainda não cobriu esse `categoryTarget` — throttle semanal, ver `sync-brandwatch.md`) | Seções "Principais disseminadores"/"Menções relevantes" mostram `<EmptyState />` textual ("ainda sincronizando"), não erro |
| Narrativa sem nenhuma linha em `cases` (schema é somente leitura, sem UI de criação ainda — ver `data-model.md`) | Seção "Ações e decisões" mostra `<EmptyState />` textual ("Nenhuma ação registrada ainda"), não erro — não bloqueia o resto da página |
| Falha ao carregar um widget | `<ErrorMessage retry />` por widget, mesmo padrão de `executive-overview.md` |

## Interface (UI)

### Lista (`/narratives`)

Idêntica à tabela do Executive Overview (ver `foundation/overview.md`), mais
o painel de resumo/grid de cards descritos acima. ✅ **Decidido
(2026-07-12)**: sem filtros próprios adicionais por enquanto (o documento
de estrutura original pedia plataforma/sentimento/narrativa/pauta/tipo de
autor/risco — retirados desta primeira versão a pedido do usuário). Os
filtros de **período** e **organização** do header global
(`executive-overview.md`) continuam valendo. Filtros próprios desta página
ficam como ampliação futura, sem spec de comportamento por ora.

> ✅ **3 toggles adicionados (2026-07-14)** — todos client-side, sem
> parâmetro novo em `get-page-narratives`/`get_narratives_table` (mesmos
> `rows` já buscados, só reorganizados/filtrados na UI):
> 1. **Exibição** ("Tabela e cards"/"Só tabela"/"Só cards") — topo da
>    página, acima da tabela. Controla se a tabela interativa e/ou a grade
>    de cards por categoria (`NarrativeCategoryLanes`) aparecem. Default
>    "Tabela e cards" (comportamento equivalente ao que existia antes deste
>    pedido).
> 2. **Agrupamento da tabela** ("Subcategorias"/"Categoria e subcategoria")
>    — no cabeçalho do próprio widget da tabela (`WidgetCard`'s
>    `headerAction`). "Subcategorias" (default) é a lista plana de sempre;
>    "Categoria e subcategoria" agrupa por `category_label` — mesmo campo/
>    lógica de agrupamento já usada pela grade de cards por categoria
>    (`NarrativeCategoryLanes`, 2026-07-25), aplicado agora também à
>    tabela, com cabeçalho de grupo expansível/recolhível (▲/▼) por
>    categoria.
> 3. Selecionar uma linha muda o layout do bloco da tabela de 1 coluna
>    (tabela cheia) para 2 colunas (tabela + painel `NarrativeCard` de
>    400px à direita) — ver item 3 do "Fluxo principal" acima.
>
> Em "Só tabela", a grade de cards nunca aparece — o painel lateral ao
> selecionar uma linha é o único caminho pra ler o resumo executivo
> completo de uma Narrativa sem sair da página, por isso esse layout é
> tratado como parte essencial (não cosmética) desse modo de exibição. Em
> "Só cards", a tabela (e a seleção que depende dela) fica oculta — a
> grade por categoria aparece sempre, independente de qualquer seleção
> remanescente de uma troca de modo anterior.

✅ **Cards redesenhados (2026-07-21)**, referência visual do usuário: o
grid de cards ("nenhuma linha selecionada" — item 4 do "Fluxo principal")
usa o novo `NarrativeCard` compartilhado (`components/intelligence-center/
narrative-card.tsx`) — borda esquerda colorida pelo sentimento (3 estados:
vermelho/verde/neutro), SOV + total de menções em destaque, barra de risco
(mesma cor/faixa do badge de risco), texto de resumo, barra de sentimento
positivo/neutro/negativo e tags (termos/hashtags reais). Mesmo componente
reusado pelo widget "Top 3 Narrativas" da Visão Geral (`executive-overview.md`)
— todo card de Narrativa no produto segue este layout, não um por página.
Ver `aggregated-metrics/sql-aggregation.md`, "Campos do card de Narrativa",
para de onde vem cada campo novo (`sentiment_positive_pct`/`summary`/`tags`
em `get_narratives_table`).

✅ **Mapeamento de tópicos por polaridade (2026-07-14)**, pedido do
usuário: "no caso das narrativas é importantíssimo esse mapeamento dos
tópicos com a narrativa para melhorar o entendimento da IA e do usuário
final." `NarrativeCard` ganhou 2 novas linhas de chips coloridos, acima
da linha neutra de `tags` já existente — `positive_topics`/
`negative_topics` (`get_narratives_table`, migration `20260805010000`,
até 3 termos por lado no card, verde/vermelho, mesma paleta de
`DriverChip`), mesma classificação por maioria de `get_term_signals` só
que calculada por Narrativa. Ver `aggregated-metrics/sql-aggregation.md`,
"Mapeamento tópico↔Narrativa por polaridade", para a fórmula completa e
para como isso também alimenta a IA (`narrative_summary_build_payload` e
o payload de `ai-synthesis` Camada 1, via o bloco `narratives` do
envelope).

✅ **Cards agrupados por categoria (2026-07-25)**, pedido do usuário: "os
cards que ficam abaixo, devem ser organizados pela categoria. Podemos
utilizar raia ou outro componente que achar mais apropriado para facilitar
o agrupamento e localização da narrativa." O grid único de
`NarrativeCard`s (item 4 do "Fluxo principal") foi substituído por
`NarrativeCategoryLanes` (`components/intelligence-center/
narrative-category-lanes.tsx`): uma "raia" (seção) por Category-pai da
Narrativa (`NarrativeRow.category_label`, novo campo em
`get_narratives_table`, migration `20260725050000` — ver
`sql-aggregation.md`, "Campos do card de Narrativa") — cabeçalho com o
nome da categoria + contagem de Narrativas, seguido da mesma grade
responsiva de `NarrativeCard`s de antes (`grid-cols-1 sm:grid-cols-2
md:grid-cols-3`), agora escopada àquela categoria. Categorias ordenadas
alfabeticamente (pt-BR, `localeCompare`) — o objetivo é achar uma
Narrativa rapidamente ("localização"), não repriorizar por risco (a
tabela interativa acima já cobre priorização); dentro de cada categoria, a
ordem original de `get_narratives_table` (risco desc) é preservada.
⚠️ **Decisão de design, não uma decisão de produto em aberto**: optado por
seções empilhadas verticalmente (grid que quebra linha) em vez de uma raia
com rolagem horizontal estilo Kanban — este produto não usa esse padrão de
interação em nenhuma outra tela, e uma grade que quebra linha é 100%
escaneável sem exigir arrastar/rolar lateralmente, mais alinhado ao
"localização" pedido. Revisitar se o usuário preferir explicitamente o
padrão de rolagem horizontal.

✅ **Estender/recolher por raia (2026-07-25)**, pedido do usuário, mesma
sessão: cada cabeçalho de categoria em `NarrativeCategoryLanes` é um botão
(`aria-expanded`/`aria-controls`, acessível) que alterna a grade daquela
categoria — mesmo indicador visual ▲/▼ já usado pelo botão "Filtros" do
header global (`page-header-bar.tsx`), não um ícone novo. Todas as
categorias começam expandidas; o estado (`Set` de categorias recolhidas)
vive só no componente, sem persistência entre navegações — mesmo padrão
já aceito para `filtrosOpen` no header.

### Detalhe (`/narratives/[id]`)

- **Cabeçalho**: nome, badges de SOV/sentimento/risco/momentum/tendência
  (mesmos scores e faixas de `executive-overview.md`); "Voltar para
  Narrativas" na página cheia, "Abrir página completa" no modal (ver
  "Fluxo principal" item 5).
- **Cards de indicadores**: crescimento vs. período anterior, autores
  únicos, alcance estimado, engajamento total — **ver nota de gap abaixo
  sobre "autores únicos"**.
- **Resumo executivo**: texto de 3–5 linhas. ✅ **Atualizado 2026-07-13**:
  como não há CRUD de Narrativas em nenhuma camada do produto (ver
  `foundation/narratives.md`), **edição manual está descartada** — a única
  via possível pra preencher `narratives.description` é geração automática
  no backend. Ainda não desenvolvido — o frontend
  continua só **reservando o campo** (ler e exibir
  `narratives.description`, `foundation/data-model.md` — vazio/`<EmptyState />`
  textual quando `null`). Não bloqueia o resto da página. ✅ **2026-07-21**:
  o mesmo campo (`summary` no bloco `narratives` do envelope, ver
  `aggregated-metrics/sql-aggregation.md`) também passou a ser lido e
  exibido pelo `NarrativeCard` da lista/grid — a "reserva" deixou de ser só
  teórica, o componente já está no ar pronto para receber o texto assim
  que um produtor popular a coluna, sem mudança de contrato.
  ✅ **Implementado (2026-07-14)**: produtor real construído —
  `narrative-summary-composer` (Edge Function nova, `pg_cron` a cada
  30min, migration `20260804010000`), **não** a Camada 1 de `ai-synthesis.md`
  cogitada acima (aquela é síntese por página/período a partir de
  `highlights` já prontos; um resumo por Narrativa sem janela de período
  não se encaixa nesse contrato). Ver `foundation/narratives.md`, "Resumo
  executivo (produtor)", pro fluxo completo — scores via
  `get_narratives_table` + eventos recentes do `event-radar` +
  Comunicações/Decisões recentes (`communications`), texto livre via
  Claude Haiku 4.5. `NarrativeCard`/`narrative-detail-content.tsx` não
  mudam — já liam e exibiam o campo desde 2026-07-21, só o fallback deixa
  de aparecer assim que o job processar cada Narrativa (pode levar até um
  ciclo de 30min + o tempo de detecção de staleness na primeira rodada
  depois do deploy).
- **Evolução (narrativa vs. volume geral)**: série temporal de
  `narrative_metrics.total_mentions` (Narrativa) sobreposta a
  `bw_query_metrics_daily.total_mentions` com `category_id is null` (Query
  inteira) — ambos agregados oficiais, sem cálculo local.
- **Formação e propagação**: texto (ver "Resumo executivo" acima — mesmo
  tratamento: campo reservado no frontend, lógica de preenchimento é
  backend futuro) + lista de "principais disseminadores". ✅ **Implementado
  (2026-07-14)**: não lê `bw_query_top_authors` direto — reusa
  `get_authors_ranking` (o mesmo ranking de autores de `/platforms`/
  `/themes`/`/authors`), escopado à Narrativa via `filters.narratives`
  (`effectiveFilters`, `service-layer-aggregation.md`), renderizado pelo
  componente `AuthorsList` compartilhado (`entity_cargo`/`account_type`
  como "tipo", `reach`/`engagement`/`mentions`, badge "Influente"). Não é
  um ranking próprio de "quem propagou a Narrativa" — é o ranking geral de
  autores já filtrado a essa Narrativa, ordenado por padrão por alcance.
  - **Detratores / Impulsionadores positivos**: ✅ **Implementado
    (2026-07-14)**. Derivado no frontend, sem chamada de rede adicional,
    a partir do mesmo bloco `authors` já buscado acima: entre os autores
    listados como disseminadores da Narrativa, "Detratores" = sentimento
    dominante negativo, "Impulsionadores positivos" = sentimento dominante
    positivo (`AuthorRow.sentiment_positive/neutral/negative`,
    `dominantSentiment()` em `author-color.ts` — mesma lógica já usada
    pelo badge de sentimento da coluna "Sentimento" de `AuthorsList`), cada
    lista ordenada por alcance, top 5. ⚠️ **Limitação real de cobertura,
    documentada explicitamente na UI**: `sentiment_positive/neutral/negative`
    só é populado pelo `bw-sync` para os top 10 autores por volume **da
    Query inteira** (`runAuthorEnrichmentStep`/`bw_query_author_topics`,
    ver `foundation/data-model.md` §5) — não há enriquecimento de
    sentimento por autor específico por Narrativa. Na prática, isso
    significa que só autores que estão simultaneamente (a) entre os top 10
    globais por volume e (b) presentes no ranking desta Narrativa recebem
    uma classificação — para muitas Narrativas, uma ou ambas as listas
    podem vir vazias (`<EmptyState/>` textual, nunca um valor inventado).
    Alinhado com o pedido original ("detratores e impulsionadores
    positivos, **se houver**") — a possibilidade de lista vazia é esperada,
    não um bug. Widen para enriquecimento por Narrativa é um gap real de
    engenharia (custo em orçamento de chamadas Brandwatch), não decidido
    aqui — ver `_pending.md`.
- **Grafo de disseminação simplificado**: ✅ **Decidido (2026-07-12)**:
  construir uma versão simplificada já na Sprint 2, sem esperar o módulo
  `propagation-graph` (Sprint 3, rollup materializado completo). Fonte de
  dado: os campos de relacionamento já capturados **por mention**
  (`mentions.reply_to`/`retweet_of`/`insights_mentioned`, ver
  `foundation/data-model.md` §3), restrito às mentions já sincronizadas via
  `narrative_matched_mentions(narrative_id)` (mesma função canônica já
  usada em "Menções relevantes" abaixo — não uma query nova). Nós = autores
  únicos entre essas mentions (origem/quem respondeu/retuitou/foi citado);
  arestas = as relações `reply_to`/`retweet_of`/`insights_mentioned`
  observadas dentro desse conjunto. **Rotular explicitamente na UI**
  ("amostra das conexões capturadas nas mentions sincronizadas", não "grafo
  de propagação completo") — isso não é o rollup agregado do
  `propagation-graph` (que cobrirá todo o histórico e será materializado),
  é uma visualização sobre o que já foi sincronizado, sem violar a premissa
  de sampling porque cada nó/aresta é um fato sobre uma mention
  individualmente capturada, não uma soma/contagem apresentada como total.
  Migrar para o rollup do `propagation-graph` quando esse módulo existir,
  sem mudar a semântica pro usuário (mesma rotulagem de "amostra" até lá se
  o rollup completo não cobrir 100% do histórico ainda).
- **Termos e frases mais citados**: ✅ **Implementado (2026-07-14)**. Bloco
  `term_signals` (`get_term_signals`, já existente e usado por
  `/sentiment`/`/themes`) adicionado a `PAGE_BLOCKS.narrative_detail` —
  antes disponível como dado (`bw_query_topics` já é sincronizado por
  `categoryTarget`, incluindo cada Narrativa, ver `sync-brandwatch.md`)
  mas nunca pedido por esta página. Escopado à Narrativa automaticamente
  via `filters.narratives` (mesmo mecanismo de "principais
  disseminadores" acima — `get_term_signals` já suporta
  `filter_category_ids`, não precisou de mudança em SQL). Renderizado
  como nuvem de palavras (`TermSignalsList`, mesmo componente de
  "Termos emergentes" em `/themes`) — mistura `words`/`phrases`/
  `hashtags`/etc. sem filtrar só `topic_type = 'phrases'` (mesma nota já
  registrada em `_pending.md` gap #24 para as demais páginas que usam
  este bloco). ✅ **Ganhou também "Tópicos positivos"/"Tópicos negativos"
  (2026-07-14, mesma sessão)** — mesmo `term_signals` já escopado à
  Narrativa, só separado por polaridade — pedido do usuário de
  "importantíssimo esse mapeamento dos tópicos com a narrativa" aplicado
  também ao detalhe, ao lado da nuvem de palavras (que mistura todo
  `topic_type` sem indicar sentimento). ✅ **Unificado num único frame
  (2026-07-14, mesma sessão)** — pedido seguinte: "no mesmo frame mudando
  apenas a cor". "Tópicos positivos da narrativa"/"Tópicos negativos da
  narrativa" (2 `WidgetCard`s separados) viraram um único "Tópicos
  positivos e negativos da narrativa" (`TopicSentimentList`), pills
  coloridas por sentimento (verde/vermelho/neutro) na mesma lista.
- **Menções relevantes**: lista via `narrative_matched_mentions(narrative_id)`
  (função já definida em `foundation/data-model.md`) ordenada por
  `reach_estimate`/`impact` — uso de dado por mention individual (não
  agregado/somado), consistente com o mesmo padrão já usado para
  `mention_role`/`emotion` (ver nota de sampling em `foundation/data-model.md`).
- **Ações e decisões**: mostra um subconjunto de `cases` (título, status,
  `assignee_id`, `due_date` — ver entidade "Caso" em `_glossary.md`)
  filtrado por `narrative_id`. ✅ **Simplificado (2026-07-13)**: o módulo
  `command-center` foi removido da documentação — era um módulo separado
  (Sprint 2, nunca chegou a ganhar spec própria) para um requisito pequeno
  o bastante para viver dentro de `intelligence-center` sem overhead de um
  módulo à parte (checklist/comentários/arquivos/histórico de status
  completos nunca foram pedidos; o que o protótipo precisa é só esta
  listagem somente-leitura). `cases` passa a ser dado próprio de
  `intelligence-center` — ver [data-model.md](data-model.md).

  ✅ **Todas as pendências desta seção resolvidas (2026-07-13)**:
  `cases.narrative_id references narratives(id)` (não `bw_category_id`),
  `assignee_id references user_profiles(id)` (não `auth.users` direto), e
  mapeamento dos 5 valores de `case_status` pros 3 rótulos do protótipo
  (`open`/`waiting` → Pendente, `in_progress` → Em andamento,
  `resolved`/`archived` → Concluída, "manter igual ao protótipo por
  enquanto") — ver [data-model.md](data-model.md) e
  [../auth/data-model.md](../auth/data-model.md).

  Esta versão é **somente leitura** — criar/editar Casos pela UI (e o
  eventual checklist/comentários/arquivos/histórico, se algum dia forem
  pedidos) fica para uma spec própria futura, sem reabrir um módulo
  separado só para isso.

- **Comunicações e Decisões** (✅ adicionado 2026-07-25, Sprint 2.1, módulo
  `communications` — não confundir com "Ações e decisões" (`cases`) acima,
  ver `communications/overview.md`, "Relação com `cases`", que também
  cobre a sobreposição conceitual entre `cases` e o `record_type =
  'decision'` deste módulo): nova seção logo abaixo, com um resumo
  compacto (até 3 registros mais recentes — Comunicações e Decisões
  misturados — para esta Narrativa, com os indicadores de Sentimento/
  Menções/Risco/Momentum antes vs. depois), um botão **"+ Registrar"** no
  cabeçalho da seção (com o seletor "Tipo de registro" Comunicação/
  Decisão, sempre visível mesmo sem nenhum registro ainda — regra
  transversal #2) e um link "Ver linha do tempo completa →" para
  `/communications/[id]`. O botão está presente **tanto na página cheia
  (`/narratives/[id]`) quanto no modal rápido**
  (`@modal/(.)narratives/[id]`, "Fluxo principal" item 5 acima) — pedido
  explícito do usuário: "de dentro do modal e do detalhamento de uma
  narrativa, deve existir um botão para registrar uma comunicação". Abre o
  mesmo `CommunicationFormModal` com a Narrativa já pré-preenchida e
  travada (não editável), sem exigir busca/seleção — ver
  [../communications/communication-registration.md](../communications/communication-registration.md),
  "Entrada rápida a partir de uma Narrativa". Ver
  [../communications/narrative-impact-tracking.md](../communications/narrative-impact-tracking.md)
  para o desenho completo — spec ainda `rascunho`, não implementar antes
  de `communications/data-model.md` existir como migration.

## Regras de negócio

- Mesma regra de `executive-overview.md`: nenhum número de
  volume/sentimento/SOV recalculado no frontend — tudo de
  `narrative_metrics`/`bw_query_top_authors`/`bw_query_metrics_daily`.
- **"Autores únicos" por Narrativa**: ✅ **Resolvido (2026-07-12)** —
  `narrative_metrics.unique_authors` (migration `20260712020000`), de
  `bw_query_metrics_daily.unique_authors` (agregado oficial `authors` da
  Brandwatch, não amostrado — ver `foundation/data-model.md`). Sem gap.
- **Engajamento total** (card de detalhe): de
  `narrative_metrics.engagement_total` (← `bw_query_metrics_daily.engagement_score`),
  já disponível — sem gap.

## Dados envolvidos

- **Lê**: `narratives`, `narrative_metrics`, `narrative_signals`,
  `bw_query_metrics_daily` (Query inteira, `category_id is null`),
  `bw_query_top_authors` (por `category_id`), `bw_query_topics` (por
  `category_id`, para eventual seção de temas dentro da narrativa — não
  desenhada no protótipo, mencionada aqui só como dado já disponível se o
  produto quiser adicionar), `mentions` via `narrative_matched_mentions()`.
- Nenhuma escrita nesta versão (exceto edição manual de
  `narratives.description`/`notes`, se essa UI for incluída — ver "Resumo
  executivo" acima).

## Permissões

Mesma tabela de `executive-overview.md` — leitura só para membros da
organização (RLS via `auth_organization_ids()`).

## Dependências técnicas

- Reusa o mesmo componente de tabela de Narrativas do Executive Overview
  (não duplicar colunas/cálculo de cor).
- `narrative_matched_mentions()` — não reimplementar matching (ver
  `foundation/data-model.md`).

## Referências relacionadas

- [intelligence-center/overview.md](overview.md)
- [executive-overview.md](executive-overview.md)
- [foundation/data-model.md](../foundation/data-model.md)
- [foundation/narratives.md](../foundation/narratives.md)
