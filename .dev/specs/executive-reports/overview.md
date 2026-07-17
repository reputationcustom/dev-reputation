---
tipo: module-overview
módulo: executive-reports
status: pronto — não implementado
atualizado: 2026-07-17
---

# Módulo: Relatórios (executive-reports)

> 📝 **Spec criada (2026-07-17)** — pedido do usuário, 3 partes na mesma
> mensagem: (1) mover "Relatórios" do menu de Configurações para o Menu
> principal, abaixo de "Ações", como uma seção própria com 2 páginas —
> Relatório Executivo e Relatório Personalizado; (2) Relatório Executivo
> com panorama geral do período personalizado escolhido pelo usuário,
> granularidade automática (mensal/diário/por hora conforme a duração do
> período), explicações geradas por IA, exportação em PDF; (3) Relatório
> Personalizado, com desenho em aberto ("Sugira algo") para dar liberdade
> ao usuário de extrair texto e gráficos, também exportável em PDF. Esta
> sessão escreveu a spec completa — **nenhuma linha de código foi
> escrita**. Ver `data-model.md`, `executive-report.md` e
> `custom-report.md` para o detalhamento de cada peça.
>
> Este módulo já existia reservado desde o planejamento original do
> projeto (Sprint 4, `_index.md`) — "Geração de relatórios periódicos...
> reaproveita o envelope de `aggregated-metrics` (página 'Relatórios') em
> vez de agregação própria" — e vários hooks já estavam pré-posicionados
> no código antes desta sessão: `page: 'reports'` já existe em
> `PageKey`/`PAGE_BLOCKS`/`PAGE_BREAKDOWN_TYPES`
> (`aggregated-metrics-service.ts`), a Edge Function `get-page-reports` já
> é citada em `edge-functions-per-page.md`/`overview.md`/`ai-synthesis.md`
> como "esperada, ainda não implementada", e o nome da tabela
> `reports_generated` já vem do schema anexo do Dia 1
> (`_index.md`, tabela de renomeação). Esta spec fecha esse plano —
> reaproveitando os nomes/chaves já reservados em vez de inventar novos —
> e adiciona o que faltava: a segunda página (Relatório Personalizado), a
> regra de granularidade específica deste relatório, a seção de IA
> dedicada, e a exportação em PDF (nunca especificada em nenhum lugar do
> projeto antes).

## Objetivo

Dar ao usuário duas formas de extrair, em PDF, uma leitura consolidada do
que está acontecendo com as Narrativas monitoradas:

1. **Relatório Executivo** (`/reports/executive`) — conteúdo fixo e
   completo (KPIs, sentimento, evolução, Narrativas, autores, termos,
   eventos do radar), sempre com uma explicação em texto gerada por IA,
   automaticamente reorganizado por granularidade (hora/dia/mês) conforme
   o tamanho do período escolhido. Pensado para "bater o olho e entender
   o panorama geral" sem precisar configurar nada além do período.
2. **Relatório Personalizado** (`/reports/custom`) — um construtor: o
   usuário escolhe período, quais blocos de dado entram no documento, se
   quer ou não um resumo gerado por IA, e pode escrever suas próprias
   notas em texto livre. Pensado para quem quer montar um documento sob
   medida (ex: só os gráficos de uma reunião específica, sem os demais
   widgets).

Os dois reaproveitam 100% o envelope já construído por `aggregated-metrics`
(nenhuma agregação/SQL nova fora de uma extensão pontual de granularidade,
ver `data-model.md`) e os componentes visuais já existentes de
`components/intelligence-center/` — nenhum gráfico/tabela novo é
desenhado, só uma composição de página diferente pensada para virar um
PDF.

## Integração com o menu

Pedido explícito do usuário (item 1): "Relatórios" deixa de estar em
CONFIGURAÇÕES e ganha sua própria seção no menu principal, **abaixo de
Ações**. Em `components/intelligence-center/sidebar.tsx`:

- Nova seção `RELATÓRIOS` (mesmo padrão visual de `ANÁLISES`/`AÇÕES` —
  rótulo em maiúsculas acima da lista), posicionada depois de `ACTIONS_ITEMS`
  (Alertas/Comunicação) e antes da seção `CONFIGURAÇÕES`:
  - "Relatório Executivo" → `/reports/executive`
  - "Relatório Personalizado" → `/reports/custom`
- `SETTINGS_ITEMS` (hoje só `[{ href: "/reports", label: "Relatórios" }]`)
  fica vazio — a seção `CONFIGURAÇÕES` continua existindo (Administração/
  Ajuda/Perfil continuam lá), só sem itens de `SETTINGS_ITEMS` acima
  deles.
- A rota `/reports` (hoje um `ComingSoonPage`) deixa de existir como
  destino final — vira um redirect simples de servidor
  (`redirect('/reports/executive')`, Server Component, mesmo padrão já
  usado em outras rotas do produto que precisam de um redirect que não é
  a rota `/` em si — ver CLAUDE.md, "Deploy (Hostinger)", regra 3, que só
  restringe redirect na rota raiz) — preserva qualquer link/bookmark
  antigo sem precisar manter o `ComingSoonPage`.

## As duas páginas, em uma frase cada

- **Relatório Executivo** (`executive-report.md`): período personalizado
  arbitrário (não os presets Diário/Semanal/Mensal do resto do produto),
  granularidade automática hora/dia/mês, IA sempre presente, tudo
  pré-definido — o usuário só escolhe as datas e clica "Gerar relatório".
- **Relatório Personalizado** (`custom-report.md`): mesmo conceito de
  período livre, mas o usuário escolhe quais blocos entram, se quer IA
  (opt-in, não automática), e pode escrever suas próprias notas em texto
  livre antes de exportar.

Os dois compartilham: o mecanismo de exportação em PDF (`data-model.md`,
"Por que a geração do PDF é 100% client-side"), o histórico
`reports_generated` + bucket de Storage `reports`, e a extensão do
envelope de `aggregated-metrics` (granularidade `auto_report`, blocos
`authors`/`term_signals` em `PAGE_BLOCKS.reports`, novo page key
`reports_custom`, nova seção Camada 2 `reports:executive_summary`).

## Rotas / Páginas

| Rota | Edge Function | Página | Consumo de IA |
|---|---|---|---|
| `/reports` | — | Redirect para `/reports/executive` | — |
| `/reports/executive` | `get-page-reports` (`page: 'reports'`) | Relatório Executivo | Sempre (`section: 'main'` + `section: 'executive_summary'`) |
| `/reports/custom` | `get-page-reports-custom` (`page: 'reports_custom'`) | Relatório Personalizado | Opt-in (`section: 'executive_summary'`, só se marcado) |

`export-report`/`list-generated-reports` são compartilhadas pelas duas
páginas (parametrizadas por `type`), não uma Edge Function por página.

## Dependências

- **`aggregated-metrics`** — o envelope inteiro (todas as 10 functions SQL
  já existentes), mais 3 extensões pontuais que este módulo precisa (ver
  `data-model.md` para o detalhe de cada uma):
  1. `get_volume_trend` ganha `p_grain_mode` (`'auto_dashboard'` default,
     sem efeito em nenhum consumidor existente; `'auto_report'` para a
     regra hora/dia/mês pedida nesta spec).
  2. `PAGE_BLOCKS.reports` ganha `authors`/`term_signals`;
     `PAGE_BREAKDOWN_TYPES.reports` ganha `platform`/`theme`.
  3. Novo page key `reports_custom` (todo bloco relevante do envelope de
     uma vez, ver `data-model.md`) e nova seção Camada 2
     `reports:executive_summary` em `ai-synthesis.md`.
- **`event-radar`** — `feed_events`/`highlights`, via `get_active_highlights`
  já existente, para "o que aconteceu no período" nos dois relatórios.
- **`entities`** — enriquecimento do bloco `authors` (partido/ideologia/
  tipo), quando presente — aditivo, nenhum relatório depende disso para
  funcionar.
- **`auth`** — organização ativa (RLS), `user_profiles.timezone` para
  formatar datas no PDF (mesma regra global de timezone do produto).

Nenhuma dependência de `finops`/`sync-console` — módulos administrativos
sem relação com o conteúdo dos relatórios.

## Fora de escopo (nesta spec)

- **Agendamento automático** (envio periódico por e-mail, "toda
  segunda-feira às 8h") — não pedido; `reports_generated` já guarda
  histórico e `params` (para o Personalizado) o bastante para adicionar
  isso depois sem mudança de schema — só um `pg_cron` novo chamando
  `export-report` no lugar de um clique manual.
- **Relatório de crise** — o schema anexo do Dia 1 já reserva o valor
  `type = 'crisis'` no vocabulário de `reports_generated`, mas nenhum
  requisito desta sessão pede um terceiro tipo de relatório; fica fora
  até ser pedido explicitamente (mesmo `check` aceitaria o valor sem
  migration quando o dia chegar).
- **Comparação de 2 períodos lado a lado num só PDF** ("este mês vs. mês
  passado") — cada exportação cobre um único período; se o produto quiser
  isso no futuro, é uma composição de 2 relatórios, não uma 3ª página.
- **Compartilhamento/edição colaborativa** do relatório gerado com outra
  organização ou usuário externo — o PDF baixado pode obviamente ser
  compartilhado por fora do produto, mas não há um link "público" gerado
  pela plataforma.
- **Envio automático por WhatsApp/e-mail direto da tela** — só download
  local do PDF.
