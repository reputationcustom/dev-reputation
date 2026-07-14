---
tipo: module-overview
módulo: entities
status: pronto
atualizado: 2026-07-13
---

# Módulo: Cadastro de Entidades

> ✅ **Especificado nesta revisão (2026-07-13)**, a partir do pedido do
> usuário: "Crie a especificação do módulo de cadastro de entidades (CRUD).
> Está disponível apenas para administradores. O objetivo é cadastrar
> pessoas importantes de monitorar e associá-las a vários espectros... e
> vincular essa tabela com a visão de autores e influencias." Módulo já
> existia como linha reservada em `_index.md`/`_glossary.md` desde a
> criação do projeto (nome `entities`, tabelas `entities`/`entity_accounts`/
> `entity_tags` já citadas na tabela de renomeação do schema anexo) mas
> nunca tinha ganho spec própria — este é o primeiro conjunto de arquivos
> do módulo. Nenhum código foi escrito nesta sessão, só especificação.
>
> ✅ **Decisão de escopo resolvida com o usuário nesta sessão**: o cadastro
> é um **catálogo único, compartilhado por toda a plataforma** ("Cadastro
> Nacional de Entidades", nome já reservado em `_glossary.md`), não
> isolado por organização — ver "Escopo: catálogo global, não por
> organização" abaixo.
>
> ✅ **`data-model.md` implementado no mesmo dia (2026-07-13)** — schema
> (migration `20260731000000`) + seed real de 21 partidos e 593
> parlamentares federais (512 deputados + 81 senadores, migration
> `20260731010000`, dados oficiais de `dadosabertos.camara.leg.br`/
> `legis.senado.leg.br`) — ver `data-model.md`
> para o detalhe completo, inclusive o que foi deliberadamente deixado de
> fora do seed (contas de rede social, nível de influência, espectro
> político — tudo sem fonte confiável em lote ou explicitamente subjetivo).
> `entity-registration.md` (tela de CRUD) e `author-linking.md` (vínculo
> com o ranking de Autores) continuam só especificados, não implementados
> — o catálogo já existe e já está populado, mas ainda só editável via SQL
> direto, não pela UI.
>
> ✅ **`entity_accounts` dos 512 Deputados Federais também populada no
> mesmo dia** (migration `20260731030000`) — fonte oficial real
> (`redeSocial` do endpoint de detalhe de cada deputado na Câmara), 976
> contas em 4 plataformas. Sem fonte equivalente para os 81 Senadores (API
> do Senado confirmadamente não expõe esse dado) — ver `data-model.md`
> para o detalhe completo.

## Objetivo

Dar aos administradores da plataforma um cadastro estruturado das pessoas,
veículos de imprensa, partidos, instituições, empresas e movimentos mais
relevantes para o debate público monitorado — "pessoas importantes de
monitorar", no pedido original — e classificá-los em múltiplos espectros
simultâneos (posicionamento político, partido, cargo/função, poder/
instituição a que pertence, estado, nível de influência sobre a campanha
monitorada, e qualquer nova dimensão que surgir no futuro, sem migration).
Diferente do ranking de autores já nativo da Brandwatch (`bw_query_top_authors`/
`bw_query_top_tweeters`, ver `foundation/data-model.md`) — que é
**automático e exaustivo** (todo autor com volume relevante aparece) —, o
Cadastro de Entidades é **manual e curado**: só entra quem um administrador
decidir que vale a pena classificar. As duas coisas se complementam (ver
[author-linking.md](author-linking.md)): o ranking diz "quem está falando
muito"; o cadastro diz "quem essa pessoa é, e qual o lado dela" — a
combinação das duas é o que sustenta relatórios "por diversas perspectivas"
(ex: "volume de menções por espectro político", "quais partidos mais
influenciam a narrativa X"), que nenhuma das duas fontes responde sozinha.

## Escopo: catálogo global, não por organização

✅ **Resolvido nesta sessão** (pergunta feita ao usuário, resposta:
catálogo global). `entities` **não tem `organization_id`** — é um catálogo
único, mantido pelos administradores da plataforma (`user_profiles.is_admin`,
já uma flag **global**, não por organização, ver `auth/data-model.md`) e
visível (leitura) para qualquer usuário autenticado de qualquer
organização, mesmo padrão já usado por `communication_types`
(`communications/data-model.md`, "tabela global, mesmo papel que um enum
Postgres teria"). Razões:

- O nome do módulo já era "Cadastro **Nacional** de Entidades" desde antes
  desta spec existir (`_glossary.md`) — sinal de que a intenção original
  sempre foi um catálogo único, não um por cliente.
- Evita recadastrar a mesma figura pública (ex: um senador, uma emissora de
  TV nacional) em cada organização/campanha separadamente — múltiplos
  clientes da Lidi frequentemente monitoram os mesmos atores do debate
  público nacional.
- `is_admin` já é global por design (`auth/user-management.md`) — não
  exige nenhum mecanismo novo de permissão, só reaproveita
  `is_current_user_admin()`.

⚠️ **Trade-off aceito, não uma omissão**: como o catálogo é único, não é
possível hoje que duas organizações classifiquem a mesma pessoa de forma
diferente (ex: um espectro político visto de forma diferente por dois
clientes rivais) — se isso for pedido no futuro, é uma extensão aditiva
(uma tabela de "override" por organização), não uma mudança no que existe
aqui.

## Funcionalidades

| Funcionalidade | Descrição resumida | Status | Spec |
|---|---|---|---|
| Modelo de dados (`entities`, `entity_accounts`, `entity_tags`) | Estrutura EAV — pessoa/veículo/partido/instituição/empresa/movimento, contas por plataforma, classificação extensível por dimensão | **implementado** (2026-07-13, migration `20260731000000` + seed de partidos/parlamentares `20260731010000` — ver `data-model.md`) | [data-model.md](data-model.md) |
| Cadastro de Entidades (CRUD) | Tela `/admin/entities`, admin-only — criar/editar/desativar/excluir | pronto | [entity-registration.md](entity-registration.md) |
| Vínculo com Autores e Influenciadores | Como uma Entity se conecta ao ranking nativo de autores da Brandwatch (`get_authors_ranking`) e habilita cadastro rápido a partir de um autor já visto | pronto | [author-linking.md](author-linking.md) |

## Dependências

- **Módulos que este depende**: `auth` — `is_current_user_admin()`
  (`auth/data-model.md`) é a única checagem de permissão deste módulo;
  `foundation` — `set_updated_at` (trigger reaproveitada, mesma de todo o
  projeto) e, indiretamente, `bw_query_top_authors`/`bw_query_top_tweeters`/
  `mentions.author_handle_normalized` como o lado "Brandwatch" do vínculo
  (ver [author-linking.md](author-linking.md)).
- **Módulos que dependem deste** (dependência **fraca/opcional** — ver
  `_architecture.md`, seta pontilhada `ENTITIES -.-> AGGMETRICS`):
  `aggregated-metrics` (`get_authors_ranking` ganha um enriquecimento
  aditivo quando uma Entity está cadastrada e vinculada — nunca um
  pré-requisito do ranking em si, que já funciona hoje inteiramente sem
  este módulo). A página "Autores e Influenciadores" já existe e já está
  **implementada** (`/authors`, `get-page-authors`,
  `intelligence-center/authors-and-influencers.md`, 2026-07-25) — ela
  própria já documenta a classificação por partido/espectro (`entities`)
  como um gap conhecido, exatamente o que este módulo fecha (ver
  [author-linking.md](author-linking.md)). A futura tabela de otimização
  `narrative_entities` (cross-tab Narrativa × Entity, ver
  `foundation/overview.md`, "Preparação para relatórios e cruzamento")
  também depende deste módulo existir primeiro, mas não faz parte do
  escopo desta spec (ver "Notas para implementação" abaixo).

## Rotas/Páginas

| Rota | Componente/Página | Acesso |
|---|---|---|
| `/admin/entities` | Lista + cadastro/edição de Entidades | `is_admin = true` (mesmo padrão de `/admin/users`) |

Vive dentro do route group externo `(intelligence-center)`, mesmo nível de
`/admin/users`/`/perfil` — **não** dentro de `(analytics)`: diferente de
`communications` (que é dado escopado por organização e por isso reaproveita
o gate de organização daquele layout), `entities` não depende de
organização nem de período ativo, mesma razão pela qual `/admin/users`
também vive fora de `(analytics)`.

## Ordem de implementação

Sequência estrita — cada etapa consome a anterior:

1. [data-model.md](data-model.md) → cria `entities`/`entity_accounts`/`entity_tags`.
2. [entity-registration.md](entity-registration.md) → tela de CRUD sobre as tabelas acima.
3. [author-linking.md](author-linking.md) → consome `entities`/`entity_accounts` já populadas
   para enriquecer `get_authors_ranking` (`aggregated-metrics`) — só faz sentido depois que
   existe ao menos uma Entity cadastrada com conta vinculada.

## Dados gerenciados

Ver [data-model.md](data-model.md).

## Notas para implementação

- **Fora de escopo desta spec, deliberadamente**: qualquer mudança na
  página "Autores e Influenciadores" em si (`/authors`, `get-page-authors`,
  já implementada — `intelligence-center/authors-and-influencers.md`) além
  de consumir o enriquecimento aditivo que este módulo passa a fornecer —
  layout/widgets da página pertencem a `intelligence-center`, não a este
  módulo. Este módulo só fecha o gap de dado que aquela spec já documenta
  explicitamente ("Gaps conhecidos": classificação de espectro político/
  tipo de autor) — ver [author-linking.md](author-linking.md).
- **Também fora de escopo**: `narrative_entities` (tabela de otimização/
  materialização já registrada como recomendação futura em
  `foundation/overview.md`, "Preparação para relatórios e cruzamento") —
  não é um requisito estrutural (o `JOIN` via `entity_accounts.username`
  já responde as mesmas perguntas hoje, só sem cache), fica para quando um
  relatório concreto precisar de performance melhor que um `JOIN` ao vivo.
- Nenhuma `⚠️ DECISÃO PENDENTE` em aberto neste módulo — a única decisão de
  produto genuinamente ambígua (escopo global vs. por organização) foi
  resolvida com o usuário antes de escrever esta spec (ver acima).

## Referências relacionadas

- [data-model.md](data-model.md)
- [entity-registration.md](entity-registration.md)
- [author-linking.md](author-linking.md)
- [../_glossary.md](../_glossary.md) — "Entity", "entity_tags"
- [../_index.md](../_index.md) — tabela de módulos
- [../auth/data-model.md](../auth/data-model.md) — `is_current_user_admin()`
- [../auth/user-management.md](../auth/user-management.md) — padrão de tela admin-only reaproveitado
- [../foundation/overview.md](../foundation/overview.md) — "Preparação para relatórios e cruzamento (Narrativa × Entity)"
- [../foundation/data-model.md](../foundation/data-model.md) — `bw_query_top_authors`/`bw_query_top_tweeters`/`mentions.author_handle_normalized`
- [../aggregated-metrics/sql-aggregation.md](../aggregated-metrics/sql-aggregation.md) — `get_authors_ranking`
