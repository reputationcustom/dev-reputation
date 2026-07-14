---
tipo: feature-spec
módulo: intelligence-center
funcionalidade: authors-and-influencers
status: implementado
atualizado: 2026-08-08
---

# Autores e Influenciadores

> ✅ **Redesenho em 2 guias (2026-08-08)**, pedido do usuário: "Precisamos
> ajustar a página Autores e Influenciadores com dois objetivos distintos:
> 1) Visualizar os autores genericamente: detratores, impulsionadores,
> alcance, engajamento, envolvimento em narrativas, etc. Top Autores, Top
> Sites, Top Stories. 2) Visualização por entidade como já existe,
> incluindo não só partido, mas imprensa, e outras organizações que pode
> existir na tabela entities." A página de guia única (redesenho de
> 2026-08-01) virou 2 guias — "Visão Geral" (todo autor, vinculado ou não;
> foco em comportamento observado: detratores/impulsionadores, alcance,
> engajamento, envolvimento em narrativas, Top Autores) e "Por Entidade"
> (só autores com `entity_id`, organizados por `entities.type` — pessoa,
> partido, veículo de imprensa, instituição, empresa, movimento, outro —
> não mais só partido). Fechou também um gap real encontrado durante a
> auditoria de backend: `bw_query_top_sites` ("Top Sites",
> `data/volume/topsites/queries`) já era sincronizada por `bw-sync` desde
> 2026-07-11 mas nunca tinha function SQL/bloco de envelope — 100%
> sincronizada, 100% inacessível ao frontend até agora. Ver "Redesenho em
> 2 guias (2026-08-08)" abaixo para o detalhe completo; a seção "Redesenho
> interativo (2026-08-01)" abaixo fica como histórico — a maior parte da
> mecânica ali descrita (dispersão, painel de detalhe, paleta) continua
> valendo, só a organização em 1 guia única é que foi substituída.

> ✅ **Implementado parcialmente (2026-07-25)**, pedido do usuário: "mover
> Perfis relevantes, X Themes (Hashtags, Posters, Stories, Emojis), Most
> Mentioned X Posters, Top Stories e Top Emojis para a página Autores e
> Influenciadores." Até esta sessão, `/authors` era um placeholder
> (`ComingSoonPage`, fora do route group `(analytics)` — sem organização/
> período) — `_index.md` já previa a página completa como dependente de
> `entities`/`event-radar` (Sprint 3-4, classificação de espectro político/
> tipo de autor), o que continua **não implementado**. O que esta sessão
> entrega é um subconjunto real e já funcional que não dependia de
> `entities` pra existir: os 2 widgets abaixo já rodavam em `/platforms`
> desde 2026-07-12/18 sobre dado 100% pronto (`bw_query_top_authors`/
> `bw_query_top_tweeters`/`bw_query_x_insights`) — só precisavam de uma
> página própria, que faz mais sentido conceitualmente aqui do que em
> Plataformas.
>
> ✅ **Redesenho implementado (2026-08-01)** — pedido do usuário: "revise a
> página e o backend de autores e influenciadores e sugira novas
> visualizações integrando com a tabela entities... totalmente interativa...
> partido, ideologia, menções, sentimentos." Revisão de código tinha
> confirmado que o widget "Perfis relevantes" (`AuthorsList`) descrito acima
> nunca ganhou nenhum cruzamento com `entities` — `get_authors_ranking`
> sempre devolveu `entity_id` hardcoded `null` (ver
> `entities/author-linking.md`, agora implementado). Um protótipo
> interativo (dados ilustrativos, aprovado pelo usuário — "protótipo
> aprovadíssimo") guiou o desenho da seção "Redesenho interativo" abaixo,
> que substitui o "Perfis relevantes" estático de 2026-07-25 por um painel
> completo: `AuthorFiltersToolbar` (filtros locais + "Colorir por"), 4
> cartões de KPI, `AuthorScatterChart` (Alcance×Sentimento),
> `AuthorMentionsByIdeology`/`AuthorSentimentByIdeology`,
> `AuthorPartyBreakdown`, `AuthorDetailPanel` (slide-over) e `AuthorsList`
> evoluída (tabela ordenável/paginada com badges de partido/ideologia).
> Todos os componentes novos vivem em `components/intelligence-center/`
> (ver "Dependências técnicas" abaixo para a lista completa) — nenhuma
> function SQL nova, nenhum bloco de envelope novo, toda a interatividade é
> client-side sobre `envelope.authors` (ver "Regras de negócio"). `npx tsc
> --noEmit` e `npm run build` confirmados limpos (19 rotas).

## Objetivo

Mostrar quem são os autores/perfis mais relevantes em monitoramento, **quem
eles são** quando cadastrados no Cadastro de Entidades (partido, ideologia,
cargo) e o conteúdo de maior alcance específico da rede X (Twitter) —
hashtags, perfis mais citados, stories/URLs e emojis mais usados. A parte
de Entidades existe para responder perguntas que o ranking sozinho não
responde — "quem tem mais alcance à direita?", "o sentimento é pior pra
qual ideologia?", "quais partidos concentram mais menções?" — sempre de
forma interativa (filtrar/cruzar sem sair da tela), nunca como um relatório
estático fixo.

## Usuários afetados

Mesmo público das demais páginas deste módulo.

## Fluxo principal

1. Usuário acessa `/authors` (item "Autores e Influenciadores" da barra
   lateral, sob ANÁLISES) — mesmos filtros globais de organização/período
   do header (`(analytics)` route group).
2. Widgets carregados independentemente:
   - **Autores e Influenciadores** (✅ redesenhado 2026-08-01 — antes
     "Perfis relevantes"/`AuthorsList` sozinho, agora o painel completo
     descrito em "Redesenho interativo" abaixo: KPIs, dispersão,
     breakdowns por ideologia/partido, tabela filtrável, painel de
     detalhe).
   - X Themes (Hashtags, Posters, Stories, Emojis) — inalterado.
3. Toda a interatividade do passo 2 (filtros, ordenação, cor-por-dimensão,
   clique) roda **inteiramente no client**, sobre o array `envelope.authors`
   já carregado — nenhuma chamada de rede nova por interação (ver "Regras
   de negócio").

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Nenhum autor sincronizado ainda | `<EmptyState />` no lugar de todo o painel "Autores e Influenciadores" (KPIs/dispersão/breakdowns/tabela) |
| Filtro atual não bate com nenhum autor (ex: partido sem menções no período) | Cada peça mostra seu próprio estado vazio local (`<EmptyState />` na dispersão/gráfico/tabela) — nunca um erro, é um resultado válido de filtro |
| Nenhum dado de X sincronizado (Query/Narrativa sem presença relevante em X) | `<EmptyState />` no widget "X Themes" |
| Falha ao carregar um widget | `<ErrorMessage retry />` isolado |

## Interface (UI)

- **Autores e Influenciadores** (✅ redesenhado 2026-08-01 — substitui o
  antigo "Perfis relevantes" só-tabela): ver "Redesenho interativo"
  abaixo para o detalhe completo de cada peça.
- **X Themes (Hashtags, Posters, Stories, Emojis)**: `XInsightsPanel`
  (`components/intelligence-center/x-insights-panel.tsx`) — 4 tabelas lado
  a lado (Top Hashtags/Most Mentioned X Posters/Top Stories/Top Emojis),
  mesmas colunas do dashboard nativo da Brandwatch (Posts/Reposts/All
  Posts/Impressions). Ver `platform-analysis.md` (seção histórica) e
  `aggregated-metrics/sql-aggregation.md` (`get_x_insights`) para a origem
  completa do dado — nada mudou na function/dado, só a página que o exibe.
  ✅ **Links clicáveis (2026-08-02)**, pedido do usuário: "tudo que for
  possível colocar link clicável em X Themes... hashtags, perfis, url de
  posts, stories, etc." `XInsightItem.name` já é literalmente "a hashtag,
  emoji, URL ou @handle citado" (`foundation/data-model.md`,
  `bw_query_x_insights`) — nenhum dado novo, só um `href` construído a
  partir do que já existe: **Hashtags** → `x.com/hashtag/<tag sem #>`,
  **Most Mentioned X Posters** → `x.com/<handle sem @>`, **Top Stories**
  (`insight_type = 'url'`, já a URL completa) → linka direto, só validando
  que a string parece uma URL de verdade antes (nunca produz um `href`
  quebrado a partir de um dado inesperado). **Top Emojis fica sem link**
  de propósito — um emoji sozinho não é um recurso navegável, não existe
  URL real pra apontar (diferente dos outros 3 tipos, que sempre são).
  Todos os links abrem em nova aba (`target="_blank" rel="noopener noreferrer"`).

## Redesenho interativo (2026-08-01)

> Substitui o widget "Perfis relevantes" (`AuthorsList` sozinho, estático,
> corta em 15 linhas sem paginação/ordenação/filtro) por um painel com 6
> peças, todas reagindo ao **mesmo estado de filtro local** (React state
> na página, não um novo bloco de envelope) — pedido explícito do usuário:
> "totalmente interativa... partido, ideologia, menções, sentimentos".
> Protótipo navegável (dados ilustrativos) aprovado pelo usuário antes
> desta spec ser escrita — a fonte de verdade de comportamento é este
> texto, o protótipo foi só validação de conceito.

### Toolbar de filtros

Uma linha de controles acima de tudo (KPIs, gráficos, tabela — todos
recalculam ao vivo, sem chamada de rede):

- **Colorir por** (segmented control: Ideologia / Partido / Sentimento) —
  controla a cor usada simultaneamente na dispersão, nos badges da tabela
  e nos avatares do painel de detalhe. Default: Ideologia.
- **Buscar** (texto livre, filtra por `name`, case-insensitive, `includes`).
- **Partido** (`<select>`, opções = `distinct entity_partido` presentes no
  `envelope.authors` atual, mais "Todos").
- **Sentimento dominante** (`<select>`: Todos / Positivo / Neutro /
  Negativo — usa a mesma lógica de `dominantSentiment()` já existente em
  `authors-list.tsx`, promovida para uma função utilitária compartilhada
  em vez de ficar só dentro do componente da tabela).
- **Só vinculados a Entidades** (checkbox) — filtra `entity_id !== null`.
- **Chips de Ideologia** (linha própria abaixo da toolbar, 5 chips:
  Esquerda/Centro-esquerda/Centro/Centro-direita/Direita) — multi-seleção
  (clicar liga/desliga, nenhum selecionado = todos aparecem), cor de cada
  chip ativo = `--ideo-*` da própria ideologia (ver "Paleta" abaixo).
  Clicar numa barra do gráfico "Menções por ideologia" (abaixo) tem o
  mesmo efeito que clicar no chip correspondente.
- **"Limpar filtros"** — reseta todos os controles acima de uma vez.

### KPIs (4 cartões)

Recalculados sobre a lista já filtrada (não o total da página):

1. **Autores no filtro** — `list.length`, com o subtítulo "N vinculados a
   uma Entity" (`list.filter(a => a.entity_id).length`).
2. **Menções totais** — soma de `mentions` (campo novo, ver
   `entities/author-linking.md`) da lista filtrada, formatado compacto
   (`12.4k`, `1.2M`).
3. **Sentimento médio** — média de `sentiment_positive - sentiment_negative`
   só entre autores com sentimento não-nulo na lista filtrada; rótulo
   qualitativo (`> 15` → "predominantemente positivo", `< -15` →
   "predominantemente negativo", entre os dois → "neutro"), mesmos limiares
   de `dominantSentiment()`. "—" quando nenhum autor filtrado tem
   sentimento.
4. **Partidos distintos** — `new Set(list.map(a => a.entity_partido)).size`
   (ignorando `null`).

### Dispersão "Alcance × Sentimento"

SVG desenhado à mão (mesmo padrão de `TrendLineChart` — sem biblioteca de
gráficos nova, ver `CLAUDE.md`, "Não duplicar UI"/nunca introduzir
dependência sem pedido explícito):

- Eixo X: `reach`, escala **logarítmica** (`log10`) — alcance tem cauda
  longa (poucos autores com alcance ordens de magnitude maior que a
  maioria), escala linear esmagaria quase todos os pontos num canto.
- Eixo Y: sentimento líquido (`sentiment_positive - sentiment_negative`,
  -100 a 100), linha de base em 0 desenhada mais forte que as demais
  gridlines.
- Raio do ponto: `engagement`, normalizado pelo maior valor da lista
  filtrada (raio mínimo 4px, máximo 18px — nunca zero, um autor sem
  engajamento ainda precisa ser clicável).
- Cor: dimensão ativa em "Colorir por" — `entity_ideologia`/
  `entity_partido`/sentimento dominante; autores sem `entity_id` (a
  maioria hoje) desenham em cinza (`--muted`) com opacidade reduzida, nunca
  escondidos (ver "Regras de negócio").
- Autores sem sentimento (fora do top ~10 enriquecido, ver
  `sql-aggregation.md`) plotam em Y=0 com um indicador visual de "sem
  dado" no tooltip — nunca inventar um sentimento neutro como se fosse
  medido.
- Interação: hover mostra tooltip (nome, cargo/partido quando vinculado,
  alcance, engajamento, sentimento); clique abre o painel de detalhe
  (ver abaixo). Legenda abaixo do gráfico, sempre presente (regra de
  acessibilidade — nunca só cor sem rótulo).

### Menções por ideologia (barras horizontais)

5 barras fixas na ordem Esquerda → Direita (nunca reordenadas por valor —
a ordem é o próprio eixo político, reordenar quebraria a leitura), soma de
`mentions` dos autores da lista filtrada em cada ideologia. Clicar numa
barra aplica/remove aquele chip de ideologia (mesmo estado dos "Chips de
Ideologia" da toolbar — os dois controlam a mesma coisa).

### Sentimento médio por ideologia (barra empilhada)

Uma linha por ideologia (mesma ordem fixa acima), barra única dividida em
3 segmentos (positivo/neutro/negativo, cores fixas de sentimento — ver
"Paleta"), % = média de `sentiment_positive`/`neutral`/`negative` entre os
autores **daquela ideologia com sentimento não-nulo** na lista filtrada.
Ideologia sem nenhum autor com sentimento no filtro atual não desenha
linha (não uma barra vazia/zerada, que se leria como "sentimento zero").

### Top partidos por alcance (barras horizontais)

Até 8 partidos, ordenados por soma de `reach` desc (diferente do gráfico
de ideologia — aqui a ordem é por valor, já que partido não tem uma ordem
natural como o eixo político). Clicar numa barra aplica o filtro de
Partido da toolbar (substitui a seleção, não soma — um autor pertence a 1
partido só).

### Tabela (evolução de `AuthorsList`)

`components/intelligence-center/authors-list.tsx` ganha, sem quebrar os
outros 2 lugares que já o usam (`/themes`, detalhe de Narrativa — ver
`entities/author-linking.md`, "Onde isso aparece"):

- Colunas novas: **Partido** (badge), **Ideologia** (badge), **Menções**
  (`mentions`, novo campo).
- **Sem mais corte fixo em 15 linhas** — paginação real (10 por página,
  `DEFAULT_PAGE_SIZE`, regra transversal #6), com os mesmos controles
  "anterior/próxima" já usados em outras tabelas do produto.
- **Ordenação clicável** por qualquer coluna numérica/partido/ideologia
  (client-side, `Array.prototype.sort` sobre a lista já filtrada — sem
  round-trip).
- Clique na linha abre o painel de detalhe (mesmo painel da dispersão).
- Avatar circular com iniciais do nome, cor = dimensão ativa em "Colorir
  por" (mesma função de cor da dispersão, extraída pra um helper
  compartilhado).
- Autor sem `entity_id`: sem badge de Partido/Ideologia (célula "—"), nome
  sem decoração extra — nunca inventar um "Outro"/"Desconhecido" como se
  fosse um valor real de classificação.
- **`/themes`/detalhe de Narrativa continuam recebendo a mesma tabela**,
  só que agora também sortável/paginada/com os badges — nenhuma prop nova
  obrigatória, os novos badges aparecem automaticamente porque já vêm no
  `AuthorRow` (aditivo, ver `entities/author-linking.md`).

### Painel de detalhe (slide-over)

Aberto por clique num ponto da dispersão ou numa linha da tabela — painel
lateral (não modal central, para poder continuar vendo o restante da
página): avatar, nome, cargo, badges de partido/ideologia, "sem vínculo
com Entity" quando aplicável, 4 estatísticas (menções/alcance/engajamento/
sentimento líquido), barra de distribuição de sentimento (quando houver
dado), lista de redes sociais vinculadas (`entity_accounts`, quando
houver) e, quando o autor **não** tem `entity_id`, a ação "+ Cadastrar
Entidade" (só visível pra admin, ver `entities/author-linking.md`,
"Cadastro rápido a partir de um autor já visto"). Fecha por "✕", clique
fora, ou Esc.

### Paleta

Reaproveita os tokens já existentes do produto (`_design-tokens.md`), não
uma paleta nova:

- Sentimento (positivo/neutro/negativo): `bg-sentiment-*`/`text-sentiment-*`
  já usados em `SentimentBar`/`ScoreLegend` — mesma paleta, não recriar.
- Ideologia (5 faixas, esquerda→direita): **nova**, já que não existe um
  token de "espectro político" hoje — usar um diverging de 2 polos (2
  tons, não uma paleta arco-íris) com um neutro cinza no centro,
  simetricamente espaçado; ⚠️ `_design-tokens.md` precisa ganhar essa
  entrada nova antes da implementação — não inventar hex ad-hoc no
  componente.
- Partido: paleta categórica existente do produto se houver uma com ≥8
  passos distinguíveis; senão, gerar por hash determinístico do nome do
  partido sobre uma paleta categórica fixa (mesmo padrão já usado em
  `TrendLineChart` pra grupos sem paleta fixa conhecida — ver
  `_pending.md`/`CLAUDE.md`, "trend de plataforma/pauta").

## Redesenho em 2 guias (2026-08-08)

> Substitui a guia única do redesenho de 2026-08-01 por 2 guias, pedido
> explícito do usuário (ver blockquote de topo). Continua 100%
> client-side sobre o mesmo `envelope.authors` já carregado (mais um bloco
> novo, `envelope.top_sites` — ver abaixo) — trocar de guia nunca dispara
> uma chamada de rede.

### Guia "Visão Geral"

Todo autor do escopo, vinculado a uma Entity ou não — o recorte é
comportamental, não organizacional:

- **Toolbar** (`AuthorGeneralFiltersToolbar`): só Buscar + Sentimento
  dominante + "Limpar filtros" — Partido/Ideologia/Tipo de Entidade não
  aparecem aqui, são o assunto da outra guia. Quando o filtro de
  Narrativa está ativo (ver abaixo), aparece como um chip removível
  ("Narrativa: X ✕") para ficar descobrível.
- **4 KPIs**: Autores no filtro, Menções totais, Alcance total (✅ novo —
  a guia única antiga não somava alcance, só "Partidos distintos", que
  não fazia sentido genericamente), Sentimento médio.
- **Detratores e impulsionadores** (✅ novo, `author-detractors-boosters.tsx`)
  — 2 mini-listas lado a lado (até 6 cada), autores predominantemente
  negativos/positivos (`dominantSentiment()`, mesmo helper de sempre),
  ordenados por alcance desc. Só considera autores dentro do recorte de
  sentimento enriquecido (top ~10 por volume) — mesma limitação já
  documentada em "Gaps conhecidos".
- **Alcance × Sentimento**: mesma dispersão de sempre
  (`AuthorScatterChart`), `colorBy` fixo em "sentimento" — ideologia/
  partido não fazem sentido nesta guia.
- **Envolvimento em narrativas** (✅ novo, `author-narrative-involvement.tsx`)
  — barras horizontais, quantos autores **distintos** citam cada
  Narrativa/pauta (`AuthorRow.narrative_labels`, um autor pode contar em
  mais de uma barra) — não uma soma de menções (isso já é coberto pela
  própria tabela de Narrativas). Clique numa barra filtra a guia por
  aquele label (substitui a seleção, não soma).
- **Top Autores** (`AuthorsList`, `variant="general"`) — mesma tabela de
  sempre, sem as colunas Partido/Ideologia (variant nova, ver "Tabela"
  abaixo).
- **Top Sites** (✅ novo, `top-sites-panel.tsx`) — tabela única (Domínio/
  Menções/Alcance/Visitantes por mês/Sentimento), fecha o gap real de
  `bw_query_top_sites` nunca exposta (ver blockquote de topo e "Dados
  envolvidos" abaixo). Mostra "Atualizado há X" (mesmo padrão de
  `XInsightsPanel`, `bw-sync` só re-sincroniza Top Sites a cada 7 dias por
  par).
- **X Themes (Hashtags, Posters, Stories, Emojis)** — inalterado
  (`XInsightsPanel`), agora agrupado na mesma seção visual de Top Sites
  ("Conteúdo em destaque") por serem ambos rankings suplementares de
  conteúdo, não comportamento de autor.

### Guia "Por Entidade"

Só autores com `entity_id` não-nulo (filtro implícito, aplicado pela
própria página antes de qualquer outro filtro — um autor sem Entity não
tem nada a mostrar aqui: sem tipo, sem partido, sem ideologia):

- **Toolbar** (`AuthorEntityFiltersToolbar`): "Colorir por" (Tipo de
  Entidade / Ideologia / Partido / Sentimento — ✅ "Tipo de Entidade" é
  novo, default desta guia) + Buscar + Partido + Sentimento + chips de
  **Tipo de Entidade** (✅ novos: Pessoa/Partido/Veículo de Imprensa/
  Instituição/Empresa/Movimento/Outro, `ENTITY_TYPE_ORDER` em
  `author-color.ts`) + chips de Ideologia (inalterados).
- **4 KPIs**: Entidades vinculadas, Menções, Alcance, Tipos de Entidade
  distintos (✅ substitui "Partidos distintos" da guia única antiga — mais
  geral, cobre qualquer `entity_type`, não só partido).
- **Por tipo de Entidade** (✅ novo, `author-entity-type-breakdown.tsx`) —
  barras na ordem fixa `ENTITY_TYPE_ORDER`, soma de `reach`. **Esta é a
  visualização que responde diretamente ao pedido do usuário** ("não só
  partido, mas imprensa, e outras organizações") — lê `entities.type`
  (já enriquecido em `AuthorRow.entity_type` desde `author-linking.md`,
  nunca usado em nenhuma visualização até esta sessão). Clique toggla o
  filtro de Tipo de Entidade (mesmo mecanismo dos chips de ideologia —
  multi-seleção, nenhum selecionado = todos aparecem).
- **Top partidos por alcance**, **Menções por ideologia**, **Sentimento
  médio por ideologia** — inalterados, só escopados à lista já filtrada
  por `entity_id != null` desta guia (continuam mostrando só as linhas
  com `entity_partido`/`entity_ideologia` preenchidos — Entities sem
  esses campos, ex: a maioria dos veículos de imprensa/institutos de
  pesquisa, simplesmente não aparecem nessas 2 barras, sem código novo
  necessário: já eram `null`-safe).
- **Alcance × Sentimento** — mesma dispersão, `colorBy` vem do controle da
  toolbar (default "Tipo de Entidade" nesta guia, diferente do fixo
  "Sentimento" da guia "Visão Geral").
- **Entidades vinculadas** (`AuthorsList`, `variant="entity"`) — ganha uma
  coluna **Tipo** (entre Autor e Partido) e, no nome do autor, mostra
  `entity_cargo` quando existe (pessoas) ou o `tag_value` de `segment`
  (✅ novo, `entitySegment()` em `author-color.ts` — lê
  `AuthorRow.entity_tags`, já buscado desde 2026-08-01 mas nunca
  renderizado em lugar nenhum até esta sessão) quando não existe cargo —
  ex: um veículo de imprensa mostra "Portal de Notícias"/"Jornal
  Impresso" (`entities/data-model.md`, seed de institutos/veículos de
  2026-07-14) em vez de ficar em branco.
- Estado vazio dedicado quando não há nenhum autor vinculado na
  organização/período atual — não um erro. ⚠️ **Mensagem corrigida
  (2026-08-09)** — usuário reportou "Autores Por Entities a página está
  vazia sem gráficos". Achado: a mensagem original apontava pra
  `/admin/entities`, uma página que **não existe** (`entity-registration.md`
  é spec `pronta`, nunca implementada — confirmado nesta sessão,
  `app/(intelligence-center)/admin/` só tem `users`/`finops`). O estado
  vazio em si está correto (nenhum autor deste escopo bate com uma conta
  já semeada, ver `author-linking.md`) — só a instrução era um link morto.
  Reescrita pra explicar que o vínculo é automático por handle contra o
  que já foi semeado no banco (partidos/parlamentares/imprensa/institutos
  de pesquisa), sem prometer uma tela de cadastro que ainda não existe.
  Usuário confirmou (pergunta direta, `AskUserQuestion`) que **não** quer
  a implementação de `/admin/entities` nesta sessão — só a correção da
  mensagem.

### Tabela (`AuthorsList`) — variantes por coluna

✅ **Nova prop `variant: "full" | "general" | "entity" | "disseminators"`
(default `"full"`)** — `general` remove Partido/Ideologia (guia "Visão
Geral" de `/authors`). `entity` acrescenta a coluna **Tipo** antes de
Partido/Ideologia (guia "Por Entidade"). `disseminators` (Autor/
Plataforma/Papel na conversa/Seguidores/Publicações/Engajamento) é usada
só pelo detalhe de Narrativa ("Formação e propagação"), não por `full`.
Mesma lista de linhas/ordenação/paginação por trás de todas — só quais
colunas renderizam muda.

⚠️ **`full` deixou de ser "as 7 colunas de sempre" (2026-08-09)** — único
consumidor: `/themes` ("Autores e comunidades por pauta"). Pedido do
usuário: "substitua a coluna Partido por tipo de entidade... Retire da
tabela o campo ideologia." Colunas atuais: Autor/Tipo/Menções/Alcance/
Engaj./Sentimento (Tipo = `entity_type`, mesma renderização/cor de avatar
já usada por `entity`, `—` sem vínculo de Entity). Ver
`electoral-themes.md` pro detalhamento.

### Bloco novo do envelope: `top_sites`

- **`get_top_sites(p_organization_id, p_period_start, p_period_end,
  p_filters)`** (migration `20260808010000`) — mesmo padrão exato de
  `get_x_insights` (escopo por Narrativa via `filter_category_ids`/`cat_ids`
  cross join, "latest" agrupado por `category_id`), lendo
  `bw_query_top_sites` (`foundation/data-model.md`) — domínios de onde as
  menções se originam, distinto de `bw_query_top_shared_sites` ("Top
  Shared Sites", domínios linkados **dentro** do conteúdo — continua sem
  function própria, gap documentado, não pedido nesta sessão). Top 15 por
  `volume`.
- `TopSiteItem` (`packages/shared-types/src/envelope.ts` + cópia inline
  nas 7 Edge Functions `get-page-*`/`get-narrative-detail`, Princípio
  técnico 5): `domain`, `volume`, `reach_estimate`, `monthly_visitors`,
  `sentiment_positive/neutral/negative`, `synced_at`.
- `PAGE_BLOCKS.authors` ganhou `'top_sites'` — único consumidor por
  enquanto, mesmo padrão de `x_insights`.
- ✅ **Achado de passagem, corrigido nesta sessão**: o arquivo canônico
  (`supabase/functions-shared-source/aggregated-metrics-service.ts`)
  estava com `XInsightItem` **sem** o campo `synced_at` na própria
  interface (`synced_at` só aparecia no shape de leitura interno e no
  `.map()` de `fetchXInsights`) — inconsistência que não quebrava nada em
  runtime (TypeScript não barra um objeto com propriedade a mais sendo
  atribuído a um tipo mais estreito) e não era pega pelo `tsc` do Next.js
  (`supabase/functions*` fica fora do `tsconfig.json` de propósito), mas
  divergia das 7 Edge Functions **já deployadas**, que já tinham
  `synced_at` corretamente desde 2026-08-03. Corrigido no canônico junto
  desta mudança — as 7 cópias deployadas não precisaram de nenhuma
  alteração nesse campo específico (já estavam certas).

## Regras de negócio

- **Toda a interatividade desta seção é client-side**, sobre o array
  `envelope.authors` já retornado por `get-page-authors` — nenhum novo
  bloco de envelope, nenhuma nova function SQL, nenhuma chamada de rede
  por filtro/ordenação/clique. Justificativa: o próprio `get_authors_ranking`
  já devolve a lista inteira (sem paginação no banco), então filtrar/
  agregar de novo no client é barato e evita reintroduzir round-trips
  desnecessários — mesmo raciocínio já usado pra `dominantSentiment()`
  (cálculo local sobre um campo já presente no envelope, não uma soma
  sobre `mentions` cru, que continua proibida).
- Um autor sem `entity_id` **nunca** é escondido/penalizado visualmente —
  aparece em todo lugar, só sem os campos de Entity preenchidos. A maioria
  dos autores hoje não tem Entity vinculada (cadastro é manual e curado,
  ver `entities/overview.md`) — escondê-los quebraria o propósito do
  ranking (mostrar quem está falando, vinculado ou não).
- Filtros/ordenação/seleção de cor **não persistem** entre navegações
  (resetam ao sair/voltar pra página) — mesmo padrão já aceito pra
  `filtrosOpen` do header global (`header-context.tsx`).

## Dados envolvidos

- **Lê**: `bw_query_top_authors`, `bw_query_top_tweeters`,
  `bw_query_author_topics`, `bw_query_x_insights` — todos já sincronizados
  desde `foundation`, sem mudança de captura. `entity_accounts`/`entities`/
  `entity_tags` — via `get_authors_ranking` (ver
  `entities/author-linking.md`), não uma leitura direta desta página. ✅
  **`bw_query_top_sites` (2026-08-08)** — já sincronizada desde
  2026-07-11, só passou a ter function/bloco de envelope nesta sessão (ver
  "Redesenho em 2 guias" acima).
- Nenhuma escrita própria desta página — a única escrita (cadastro rápido
  de Entity a partir de um autor) reusa `create-entity`
  (`entities/entity-registration.md`).

## Permissões

Mesma tabela de `executive-overview.md` — leitura só para membros da
organização (RLS via `auth_organization_ids()`). Ação "+ Cadastrar
Entidade" no painel de detalhe é admin-only (`is_admin = true`, mesmo gate
de `entities/entity-registration.md`) — visível/oculta no client, mas a
escrita real é sempre revalidada no servidor.

## Dependências técnicas

- Nova Edge Function `get-page-authors` (`supabase/functions/get-page-authors/`)
  — cópia do arquivo canônico (`supabase/functions-shared-source/
  aggregated-metrics-service.ts`) + handler, mesmo padrão das outras 6
  Edge Functions `get-page-*` (Princípio técnico 5).
- Página movida para dentro do route group `(analytics)`
  (`app/(intelligence-center)/(analytics)/authors/`) — antes ficava em
  `app/(intelligence-center)/authors/` (mesmo nível de `/admin/users`/
  `/perfil`), sem gate de organização/período, já que era só um
  `ComingSoonPage` estático.
- `get_authors_ranking` estendida (`entities/author-linking.md`) — pré-requisito
  de todo o "Redesenho interativo" acima.
- ✅ **Implementado** — componentes novos em `components/intelligence-center/`:
  gráfico de dispersão (`charts/author-scatter-chart.tsx`), barras de
  ideologia/sentimento-por-ideologia (`author-ideology-breakdown.tsx`,
  exporta `AuthorMentionsByIdeology`/`AuthorSentimentByIdeology`), barras de
  partido (`author-party-breakdown.tsx`), painel de detalhe
  (`author-detail-panel.tsx`), toolbar de filtros
  (`author-filters-toolbar.tsx`) — `authors-list.tsx` evoluiu in-place (não
  é um componente novo). Mais um helper não previsto originalmente,
  `author-color.ts` (sem JSX) — centraliza `dominantSentiment`/cor por
  ideologia/partido/sentimento num lugar só, reusado pelos 5 componentes
  acima + `authors-list.tsx`, evitando 6 implementações divergentes da
  mesma regra de cor. Paleta de ideologia virou token real (`tailwind.config.ts`
  + `_design-tokens.md`, "Ideologia") — violeta↔teal, não vermelho/verde
  (reservados pra sentimento).
- ✅ **Redesenho em 2 guias (2026-08-08)** — componentes novos:
  `author-detractors-boosters.tsx`, `author-narrative-involvement.tsx`,
  `author-entity-type-breakdown.tsx`, `top-sites-panel.tsx`.
  `author-filters-toolbar.tsx` deixou de exportar 1 toolbar única e passou
  a exportar 2 (`AuthorGeneralFiltersToolbar`/`AuthorEntityFiltersToolbar`)
  sobre o mesmo `AuthorFiltersState` (ganhou `narrativeLabel`/
  `entityTypes`, perdeu `onlyLinked` — agora implícito por guia).
  `author-color.ts` ganhou `ENTITY_TYPE_ORDER`/`ENTITY_TYPE_LABEL`/
  `ENTITY_TYPE_HEX`/`entityTypeLabel()`/`entityTypeHex()`/`entitySegment()`,
  e `ColorByMode` ganhou o valor `"entity_type"`. `authors-list.tsx` ganhou
  a prop `variant` (ver "Tabela" acima). Nova function SQL
  `get_top_sites` + bloco `top_sites` do envelope (ver "Bloco novo do
  envelope" acima) — propagados em `packages/shared-types/src/envelope.ts`
  e nas 7 Edge Functions `get-page-*`/`get-narrative-detail` (Princípio
  técnico 5), verificado por diff byte-a-byte contra o arquivo canônico.

## Gaps conhecidos (fora de escopo desta sessão)

- `authors[].risk_level` sempre `null` — gap pré-existente, ver
  `_pending.md` gap #11 (nenhuma spec define fórmula de risco por autor
  individual). Não confundir com `entity_influence_level` (novo,
  `entities/author-linking.md`) — são conceitos diferentes (risco
  operacional da Narrativa vs. avaliação manual de influência da Entity).
- Sentimento só existe para os autores já enriquecidos por
  `bw_query_author_topics` (hoje, top ~10 por volume da Query inteira) —
  os gráficos que cruzam sentimento com ideologia/partido refletem só esse
  subconjunto, documentado inline nos próprios widgets (ver "Sentimento
  médio por ideologia" acima), não uma limitação nova desta sessão.
- `p_period_start`/`p_period_end` de `get_authors_ranking` continuam sem
  efeito real (sempre "snapshot mais recente") — ver
  `entities/author-linking.md` pra a explicação completa (sem dado
  histórico nesta fonte pra period-scoping fazer sentido). Mesma limitação
  vale pra `get_top_sites` (✅ 2026-08-08) — `bw_query_top_sites` também só
  guarda o snapshot mais recente por par, não histórico por período.
- ✅ **`bw_query_top_shared_sites` ("Top Shared Sites") continua sem
  function/bloco de envelope (2026-08-08)** — só "Top Sites" foi pedido
  nesta sessão; domínios linkados/compartilhados dentro do conteúdo das
  menções (distinto de domínios de origem) ficam para uma sessão futura se
  pedido.

## Referências relacionadas

- [platform-analysis.md](platform-analysis.md) — origem histórica destes 2
  widgets.
- [aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md)
- [aggregated-metrics/edge-functions-per-page.md](../aggregated-metrics/edge-functions-per-page.md)
