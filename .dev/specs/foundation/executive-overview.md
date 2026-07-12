---
tipo: feature-spec
módulo: foundation
funcionalidade: executive-overview
status: pronto
atualizado: 2026-07-12
---

# Executive Overview

> ✅ **Sprint 2** (confirmado 2026-07-10: "Sprint 2 será a interface web
> com os gráficos") — esta spec descreve a tela, mas a implementação em si
> não é escopo de Sprint 1. Sprint 1 (`sync-brandwatch`/`narratives`, ver
> `overview.md`) já deixa pronto tudo que esta tela precisa ler
> (`bw_query_metrics_daily`, `narratives`/`narrative_metrics`,
> `bw_query_group_metrics_weekly`) — Sprint 2 é só consumo, sem lógica de
> negócio nova no backend.

## Objetivo

Dar ao usuário, logo após o login, uma visão executiva do que está
acontecendo: volume/sentimento ao longo do tempo, Share of Voice, e uma
tabela interativa priorizando as Narrativas que merecem atenção agora.

## Usuários afetados

Qualquer usuário autenticado, membro de ao menos uma organização (ver
`organization_members` em [data-model.md](data-model.md)).

## Fluxo principal

1. Usuário autenticado acessa `/overview`.
2. A página resolve a(s) organização(ões) do usuário (via
   `auth_organization_ids()`/RLS) — se pertencer a mais de uma, um seletor de
   organização é exibido (⚠️ DECISÃO PENDENTE: comportamento exato do
   seletor multi-org fica para quando o fluxo de troca de organização for
   especificado — ver nota de escopo em `organization_members`,
   `overview.md`).
3. Carrega, para a organização ativa e o período selecionado (default: 7
   dias):
   - Série temporal de volume por sentimento, de `bw_query_metrics_daily`.
   - Share of Voice por Query Group (se configurado), de
     `bw_query_metrics_daily`/tabela equivalente de Query Group (ver
     `data-model.md`).
   - Contagem total de mentions do período (soma de `total_mentions`).
   - Tabela interativa de Narrativas, de `reporting.narratives_overview`
     (mesma view usada pelo BI externo).
4. Usuário pode clicar "Ver" numa linha da tabela de Narrativas → navega
   para um detalhe mínimo (título, descrição, sinais ativos, métricas do
   período) — rota exata (`/narratives/[id]` ou modal) fica como
   ⚠️ DECISÃO PENDENTE, sem bloquear o resto da tela.

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Usuário sem nenhuma organização em `organization_members` | Tela de estado vazio: "Você ainda não tem acesso a nenhuma organização" — sem crash, sem redirecionar para login (sessão é válida, só falta associação) |
| Organização sem nenhum `bw_project`/sync ainda rodado | `<EmptyState />` no gráfico de volume: "Nenhum dado sincronizado ainda" |
| Nenhuma Narrativa cadastrada | `<EmptyState />` na tabela: "Nenhuma Narrativa em monitoramento" |
| Falha ao carregar (erro de rede/Supabase) | `<ErrorMessage retry />` por widget — um widget falhar não derruba os outros (cada card busca seus dados independentemente) |
| Narrativa sem linha em `narrative_metrics` para o dia selecionado, **ou** com `narrative_metrics.query_id` nulo (Category sem Query associada, ou associada a mais de uma — ver `data-model.md` "Camada de reporting", correção 2026-07-11) | Linha aparece na tabela com SOV/Tendência/Sentimento/Momentum vazios ("—"), não some da lista (Risco e Narrativa continuam vindo de `narratives`, que sempre existe) |

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
> `engagementScore`. Ver `foundation/data-model.md`, `unique_authors`, e
> migration `20260712020000`. A mesma revisão também corrigiu um gap real
> encontrado nesse processo: `reach_estimate`/`engagement_score` **nunca
> tinham sido populados** para a linha `category_id is null` (a que estes
> cards leem) — `syncCategoryDailyAggregate()` só cobre a dimensão
> `categories`, que nunca inclui a Query inteira.

## Interface (UI)

- **Header**: nome da organização ativa (+ seletor, se aplicável), seletor de
  período (7/14/30 dias). ✅ Confirmado (2026-07-12): a organização
  selecionada **restringe o acesso aos dados** de toda a aplicação, não só
  desta tela — já garantido pela RLS via `auth_organization_ids()`
  (`organizations`/`organization_members`, ver `foundation/data-model.md`);
  o seletor troca qual organização é "ativa" na sessão do frontend, a
  aplicação de acesso em si já é backend (Princípio técnico 2).
- **Cards de topo**: Total de menções, Sentimento geral (distribuição
  positivo/neutro/negativo compacta), Autores únicos, Alcance estimado,
  Engajamento total — todos de `bw_query_metrics_daily` (`category_id is
  null`), cada um com variação vs. período anterior. Share of Voice (se
  Query Group configurado) — `<EmptyState />` textual se não houver Query
  Group, não esconder o card.
- **Gráfico**: série temporal de volume por sentimento (linhas/área
  empilhada), timezone fixo `America/Sao_Paulo`.
- **Tabela interativa de Narrativas** (ver imagem de referência do usuário):
  colunas Narrativa, SOV, Tendência, Sentimento, Momentum, Risco, Ação —
  mapeamento exato de colunas → cálculo em `overview.md`
  ("Tabela interativa de Narrativas").
  - Sentimento e Risco renderizados como *dot* colorido (verde/amarelo/
    vermelho) — mapeamento exato de cor em
    [_design-tokens.md](../_design-tokens.md) (✅ definido 2026-07-12 a
    partir do protótipo de frontend, deixou de depender do skill
    `frontend-design`).
  - Ordenação default: por `risk_level` desc, depois `total_mentions` desc
    — ✅ confirmado (2026-07-12): "esse é o padrão visual, podendo o
    usuário ordenar por outras opções" (construtor de ordenação
    personalizada já descrito em `overview.md`, "Ordenação personalizada").
- **Estados**: `<Spinner />` (loading), `<ErrorMessage retry />` (erro),
  `<EmptyState />` (vazio) — por widget, conforme skill `web-app-structure`
  (`references/frontend.md`).

## Regras de negócio

- Nenhum número de volume/sentimento/SOV é recalculado no frontend a partir
  de `mentions` — tudo vem pré-calculado de `bw_query_metrics_daily`/
  `narrative_metrics`/`reporting.narratives_overview` (Princípio técnico 2,
  `_index.md`: sem lógica de negócio no frontend).
- Sentimento/Momentum da tabela de Narrativas usam os buckets definidos em
  `reporting.narratives_overview` (ver `data-model.md`) — thresholds exatos
  (±20% de sentimento líquido, faixas de Momentum) hoje são placeholders no
  SQL da view. ✅ Confirmado (2026-07-12): a lógica definitiva (fórmula de
  Momentum, thresholds de sentimento) será desenvolvida no backend junto
  com o restante do texto/geração automática ainda pendente (ver
  `narratives-exploration.md`, "Resumo executivo") — o frontend deve **só
  renderizar** o que a view/API devolver (bucket + cor), sem calcular ou
  hard-codar o threshold no cliente (mantém Princípio técnico 2), e sem
  bloquear nesta versão: usa os placeholders atuais até o backend definir a
  versão final, sem mudança de contrato esperada na tela (mesmo shape de
  campo, só o valor calculado muda).

## Dados envolvidos

- **Lê**: `bw_query_metrics_daily`, `narratives`, `narrative_metrics`,
  `reporting.narratives_overview`, `organization_members` (para resolver
  organizações do usuário).
- Nenhuma escrita nesta tela.
- Detalhes: [data-model.md](data-model.md).

## Permissões

| Ação | Quem pode |
|---|---|
| Acessar `/overview` | qualquer usuário autenticado com ao menos 1 `organization_members` |
| Ver dados de uma organização | só membros dela (RLS) |

## Notificações / Feedback

Sem toasts nesta tela (é só leitura) — erros são inline por widget (ver
Fluxos alternativos acima).

## Dependências técnicas

- Hooks React Query lendo `reporting.narratives_overview`/`bw_query_metrics_daily`
  via `@supabase/ssr` (client), seguindo o padrão hooks/services da skill
  `web-app-structure` adaptado a Next.js (`overview.md`, `_index.md`).
- `auth_organization_ids()`/RLS para resolver organização(ões) do usuário.

## Referências relacionadas

- [overview.md](overview.md) — mapeamento de colunas da tabela, decisão de
  sampling.
- [data-model.md](data-model.md)
- [narratives.md](narratives.md)
