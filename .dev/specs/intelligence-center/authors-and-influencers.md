---
tipo: feature-spec
módulo: intelligence-center
funcionalidade: authors-and-influencers
status: implementado
atualizado: 2026-08-01
---

# Autores e Influenciadores

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
  `entity_tags` — novo, via `get_authors_ranking` (ver
  `entities/author-linking.md`), não uma leitura direta desta página.
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
  histórico nesta fonte pra period-scoping fazer sentido).

## Referências relacionadas

- [platform-analysis.md](platform-analysis.md) — origem histórica destes 2
  widgets.
- [aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md)
- [aggregated-metrics/edge-functions-per-page.md](../aggregated-metrics/edge-functions-per-page.md)
