---
tipo: feature-spec
módulo: intelligence-center
funcionalidade: narratives-exploration
status: pronto
atualizado: 2026-07-12
---

# Exploração de Narrativas (lista + detalhe)

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
   mesmas 7 colunas do Executive Overview: Narrativa, SOV, Velocidade,
   Sentimento, Momentum, Risco, Ação — ordenação personalizada (ver
   [executive-overview.md](executive-overview.md), "Tabela interativa de
   Narrativas", já especificada lá; esta página reusa o mesmo componente,
   sem duplicar regra).
3. Clique numa linha → painel de resumo abaixo da tabela (nome, resumo,
   indicadores-chave, mix de plataformas) sem navegar de página —
   equivalente ao estado `hasSelection` do protótipo.
4. Nenhuma linha selecionada → grid de cards, um por Narrativa (nome,
   resumo, SOV, momentum, velocidade, botão "Explorar narrativa") —
   equivalente a `hasNoSelection`/`narrativeCards` no protótipo.
5. "Ver página completa" (no painel de resumo) ou "Explorar narrativa" (no
   card) → abre o detalhe. ✅ **Decidido (2026-07-12)**: modal sobre a
   lista (mantém contexto/filtros da lista, evita recarregar a página
   inteira para um conteúdo tão rico) — via **intercepting route** do
   Next.js App Router (`(.)narratives/[id]` sobre `/narratives/[id]`
   "cheio"): navegar a partir da lista abre como modal por cima de
   `/narratives`; acessar `/narratives/[id]` direto (link compartilhado,
   recarregar a página) renderiza a página completa, sem modal. Um único
   componente de detalhe serve os dois casos — não duplica UI.
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

### Detalhe (`/narratives/[id]`)

- **Cabeçalho**: nome, badges de SOV/sentimento/risco/momentum/velocidade
  (mesmos scores e faixas de `executive-overview.md`), botão "Voltar para
  Narrativas".
- **Cards de indicadores**: crescimento vs. período anterior, autores
  únicos, alcance estimado, engajamento total — **ver nota de gap abaixo
  sobre "autores únicos"**.
- **Resumo executivo**: texto de 3–5 linhas. ✅ **Atualizado 2026-07-13**:
  como não há CRUD de Narrativas em nenhuma camada do produto (ver
  `foundation/narratives.md`), **edição manual está descartada** — a única
  via possível pra preencher `narratives.description` é geração automática
  no backend (candidato natural: `narrative_text` de `ai-synthesis.md`,
  reaproveitando os `highlights` do `event-radar` daquela Narrativa, em vez
  de um campo solto sem produtor). Ainda não desenvolvido — o frontend
  continua só **reservando o campo** (ler e exibir
  `narratives.description`, `foundation/data-model.md` — vazio/`<EmptyState />`
  textual quando `null`). Não bloqueia o resto da página.
- **Evolução (narrativa vs. volume geral)**: série temporal de
  `narrative_metrics.total_mentions` (Narrativa) sobreposta a
  `bw_query_metrics_daily.total_mentions` com `category_id is null` (Query
  inteira) — ambos agregados oficiais, sem cálculo local.
- **Formação e propagação**: texto (ver "Resumo executivo" acima — mesmo
  tratamento: campo reservado no frontend, lógica de preenchimento é
  backend futuro) + lista de "principais disseminadores", de
  `bw_query_top_authors` filtrado por `category_id = <narrativa>` (colunas
  `author`, `reach_estimate`, `account_type`/`platform_stats` para o "tipo"
  exibido — ex: "Página de notícias", "Veículo").
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
