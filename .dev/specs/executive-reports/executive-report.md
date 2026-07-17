---
tipo: feature-spec
módulo: executive-reports
funcionalidade: executive-report
status: pronto
atualizado: 2026-07-17
---

# Relatório Executivo

## Objetivo

Dar ao usuário, em qualquer período personalizado que ele escolher — não
os 3 presets fixos (Diário/Semanal/Mensal) usados no resto do produto —
um panorama executivo completo e objetivo da situação: os principais
números (KPIs), o sentimento geral e por dimensão (plataforma/pauta), a
evolução no tempo (com a granularidade certa para o tamanho do período),
as Narrativas/autores mais relevantes, os termos que mais moveram a
conversa, os eventos detectados pelo radar dentro do período, e uma
explicação em texto corrido gerada por IA amarrando tudo isso — pronto
para ser exportado em PDF e compartilhado fora da plataforma.

## Usuários afetados

Qualquer usuário autenticado, membro de ao menos uma organização — sem
gate de `is_admin` (mesmo padrão de `communications`/das 5 páginas de
análise).

## Fluxo principal

1. Usuário acessa `/reports/executive` pelo item "Relatório Executivo"
   (menu principal, seção RELATÓRIOS).
2. Seletor de período: **não** o toggle Diário/Semanal/Mensal do header
   global (`header-context.tsx`) — 2 campos de data (início/fim), sempre
   em `period.mode: 'custom'` (ver "Regras de negócio" abaixo). Default ao
   abrir a página: mês corrente (1º dia do mês até hoje) — um ponto de
   partida razoável, não uma tela vazia.
3. Botão **"Gerar relatório"** — nada carrega automaticamente ao só trocar
   as datas, evitando disparar composição de IA a cada clique no seletor
   (mesma cautela de custo já usada em `finops`/`event-radar`). Ao clicar:
   a. Busca o envelope (`get-page-reports`, `page: 'reports'`, o período
      escolhido, `p_grain_mode: 'auto_report'` — ver "Granularidade
      automática" abaixo).
   b. Chama `compose-narrative-synthesis` (síncrona) 2 vezes —
      `section: 'main'` (o "O que os gráficos mostram?" já existente em
      outras páginas) e `section: 'executive_summary'` (a seção nova, ver
      `data-model.md`) — ambas aguardadas antes de renderizar a prévia.
   c. Renderiza a prévia completa na tela, com os mesmos componentes já
      usados nas páginas de análise (`MetricCard`, `SentimentBar`/
      `ScoreList`, `TrendLineChart`, `NarrativesTable`, `AuthorsList`,
      `TopicSentimentList`, `RecentEventsPanel` em modo lista) — sem
      reinventar nenhum visual, só reorganizado numa única tela/documento
      pensada para leitura corrida.
4. Botão **"Baixar PDF"** (habilitado só depois que o passo 3 terminar
   com sucesso) — monta o PDF via `@react-pdf/renderer` a partir do que já
   está renderizado na tela + os 2 textos de IA, chama `export-report`, e
   dispara o download da URL assinada devolvida.
5. Widget **"Relatórios gerados recentemente"** (lista de
   `reports_generated`, `type = 'executive'`, da organização ativa, mais
   recentes primeiro) permite reabrir/baixar de novo um PDF já gerado sem
   regenerar nada — nem uma nova chamada de IA.

## Granularidade automática do gráfico de evolução

Regra específica deste relatório (`p_grain_mode: 'auto_report'` em
`get_volume_trend`, ver `data-model.md`) — pedido explícito do usuário,
diferente da regra genérica dos dashboards (que tem um grão semanal
intermediário para períodos de 32-186 dias):

| Duração do período | Grão | Fonte |
|---|---|---|
| Exatamente 1 dia | Hora | `bw_query_metrics_hourly` |
| 2 a 31 dias | Dia | `bw_query_metrics_daily` |
| Mais de 31 dias ("mais de 1 mês") | Mês | `bw_query_metrics_monthly` |

Sem grão semanal — a regra do usuário só cita "mensal"/"diário"/"por
hora", então não é inventado um quarto grão aqui. "Mais de 1 mês" é lido
como "mais de 31 dias" (mesmo arredondamento já usado pela regra genérica
em `foundation/overview.md`/`sql-aggregation.md`), por consistência
interna do projeto — não uma contagem exata de meses de calendário.

## Conteúdo do panorama (blocos do envelope)

Reaproveita `PAGE_BLOCKS.reports` (ver `data-model.md` para a lista
completa e a extensão proposta) — nenhum cálculo novo fora do que
`aggregated-metrics` já expõe:

- **KPIs** (`metrics`): total de menções, sentimento geral, alcance
  estimado, engajamento total, autores únicos — mesmos 5 cards da Visão
  Geral.
- **Sentimento geral** (`breakdowns`, tipo `sentiment`) + **por
  plataforma** + **por pauta** (extensão desta spec).
- **Evolução no tempo** (`trends`): volume + sentimento, no grão
  calculado acima.
- **Principais Narrativas** (`narratives`): top 10 por risco, com
  SOV/sentimento/momentum/tendência — mesma `NarrativesTable`, sem a
  coluna "Ação" (não faz sentido navegar a partir de um PDF).
- **Principais autores/influenciadores** (`authors`, extensão desta
  spec): top 10 por alcance.
- **Termos que mais moveram a conversa** (`term_signals`, extensão desta
  spec): positivos/negativos/neutros, mesma `TopicSentimentList` já usada
  em outras páginas.
- **O que aconteceu no período** (`highlights`): eventos do radar
  detectados dentro de `period_start..period_end` — não uma janela fixa
  de 72h como o widget "Radar de Eventos", aqui é o período inteiro do
  relatório.
- **Resumo executivo (IA)**: as duas composições do passo 3b acima,
  sempre presentes — diferente do Relatório Personalizado, aqui a IA
  nunca é opcional.

## Interface (UI)

- Header próprio da página — não o `PageHeaderBar` genérico das 5 páginas
  de análise (não há seletor Diário/Semanal/Mensal nem dropdown de
  organização no topo aqui, já que o conceito central é "escolha livre de
  datas"): título "Relatório Executivo", 2 campos de data, botão "Gerar
  relatório", botão "Baixar PDF" (desabilitado + spinner enquanto
  qualquer chamada estiver em andamento — regra transversal #5 do
  CLAUDE.md).
- Um único estado de carregamento ("Gerando relatório...") cobrindo todo
  o passo 3 — é uma ação explícita do usuário, não um carregamento de
  página, então não precisa de skeleton por bloco individual (mesmo
  espírito do estado de carregamento que o botão "Analisar com IA" já usa
  em outras páginas).
- Erro em qualquer chamada (envelope ou IA) usa o padrão já estabelecido
  (`ErrorMessage` + retry) — nunca deixa a tela presa num spinner (regra
  transversal "Backend communication failures").
- Widget "Relatórios gerados recentemente" no rodapé da página — tabela
  simples (data de geração, período coberto, "Baixar" por linha via nova
  URL assinada).

## Regras de negócio

- `period.mode` é sempre `'custom'` nesta página — nunca `'daily'`/
  `'weekly'`/`'monthly'`. É isso que já impede a composição automática em
  background de disparar sozinha ao simplesmente abrir a página
  (`ai-synthesis.md`, gate de `period.mode !== 'custom'`) — o usuário
  sempre confirma explicitamente via "Gerar relatório", nunca uma chamada
  de IA involuntária.
- Um clique em "Gerar relatório" nunca é bloqueado por
  `AI_SYNTHESIS_REFRESH_HOURS`/pelo TTL das outras seções Camada 2 —
  diferente da recomposição automática das outras páginas (pensada para
  não gastar demais em segundo plano), aqui o usuário está pedindo
  explicitamente um relatório atualizado agora; sempre recompõe.
- Nenhum relatório é considerado "gerado" (botão "Baixar PDF" habilitado)
  sem as duas composições de IA terem terminado com sucesso — se qualquer
  uma falhar, o botão continua desabilitado e a página mostra o erro,
  nunca um PDF com uma seção de texto faltando silenciosamente.

## Fluxos alternativos e erros

- Período sem nenhuma menção (organização recém-criada, ou intervalo
  antes de qualquer sincronização): a prévia mostra os widgets em estado
  vazio (mesmo `<EmptyState/>` já usado em toda página do produto) e o
  "Resumo executivo" cai na Camada 0 (template determinístico, "Sem
  eventos relevantes detectados no período...") em vez de travar — mesma
  degradação graciosa já usada em toda página de análise.
- Falha ao gerar o PDF no client (ex: erro de serialização do
  `@react-pdf/renderer`): toast de erro, "Baixar PDF" permanece
  desabilitado, a prévia na tela continua visível/consultável mesmo sem
  exportar.
- Falha em `export-report` (upload ao Storage): mesmo padrão de todo Edge
  Function do projeto (log detalhado via `console.error`, mensagem
  genérica amigável — "Não foi possível salvar o relatório. Tente
  novamente." — nunca o erro técnico cru, Princípio "Edge Function error
  handling"). O `Blob` do PDF já existe no navegador antes dessa chamada —
  o download local continua oferecido ao usuário mesmo que o upload para
  o histórico falhe, para não perder o trabalho de composição de IA que
  já foi feito/esperado.

## Dependências técnicas

- `aggregated-metrics` (`get-page-reports`, extensão de
  `get_volume_trend`/`PAGE_BLOCKS.reports`, Camada 2
  `reports:executive_summary`) — ver `data-model.md`.
- `event-radar` (`feed_events`, via `get_active_highlights` já existente).
- `@react-pdf/renderer` (novo pacote npm — ver `data-model.md`, "Por que a
  geração do PDF é 100% client-side").
- Reaproveita 100% os componentes visuais já existentes de
  `components/intelligence-center/` — nenhum componente novo de
  gráfico/tabela, só uma composição de página diferente (ver "Interface
  (UI)").
