---
tipo: architecture-map
atualizado: 2026-08-05
---

# Mapa de Arquitetura — Digital Intelligent Communication

> Documento obrigatório do skill `spec-driven-dev` (regra adicionada em 2026-07-13, a pedido do
> usuário — ver "Mapa de arquitetura geral" no `SKILL.md`). Existe pra dar, num único lugar, a
> visão que só estava espalhada entre `_index.md` (tabela de módulos) e o
> `event-radar/fluxo-aggregated-metrics.md` (o único par que tinha diagrama até aqui). **Atualizar
> sempre que um módulo for criado, mudar de status, ou ganhar/perder uma dependência** — se este
> arquivo e `_index.md` divergirem, é bug de documentação, não algo aceitável de conviver.
>
> Este arquivo responde "o que é cada módulo e como eles se conectam". Pra "o que está pendente
> de decisão ou de código dentro de cada módulo", ver [_pending.md](_pending.md).

## 1. Diagrama de dependências entre todos os módulos

```mermaid
graph TD
    subgraph SPRINT1["Sprint 1 — implementado"]
        FOUNDATION["foundation<br/>sync-brandwatch + narratives"]
    end

    subgraph SPRINT2["Sprint 2 — em andamento"]
        AUTH["auth<br/>login + admin de usuários"]
        AGGMETRICS["aggregated-metrics<br/>envelope + SQL + Edge Functions"]
        INTEL["intelligence-center<br/>5 páginas do frontend + cases"]
        ENTITIES["entities<br/>Cadastro de Entidades"]
    end

    subgraph SPRINT2_1["Sprint 2.1"]
        COMMUNICATIONS["communications<br/>registro de comunicações + impacto"]
    end

    subgraph SPRINT3["Sprint 3"]
        EVENTRADAR["event-radar<br/>detecção + IA por evento<br/>(absorve threshold-engine/intelligent-feed)"]
        PROPGRAPH["propagation-graph<br/>rollup materializado completo"]
        DECISIONCENTER["decision-center<br/>AI Advisors (Q&A ad-hoc)"]
    end

    subgraph SPRINT4["Sprint 4"]
        REPORTS["executive-reports<br/>relatórios periódicos"]
    end

    subgraph TRANSVERSAL["Transversal — admin, sem Sprint própria"]
        FINOPS["finops<br/>custo de IA + custos extras"]
        SYNCCONSOLE["sync-console<br/>monitoramento + execução manual do bw-sync"]
    end

    FOUNDATION --> AUTH
    FOUNDATION --> AGGMETRICS
    FOUNDATION --> EVENTRADAR
    FOUNDATION --> PROPGRAPH
    FOUNDATION --> DECISIONCENTER

    AUTH --> INTEL
    AGGMETRICS --> INTEL
    ENTITIES -.-> AGGMETRICS

    FOUNDATION --> COMMUNICATIONS
    AUTH --> COMMUNICATIONS
    AGGMETRICS --> COMMUNICATIONS
    INTEL --> COMMUNICATIONS

    EVENTRADAR --> AGGMETRICS
    EVENTRADAR -.-> DECISIONCENTER

    AGGMETRICS --> REPORTS

    AUTH --> FINOPS
    EVENTRADAR -.-> FINOPS
    AGGMETRICS -.-> FINOPS

    AUTH --> SYNCCONSOLE
    FOUNDATION --> SYNCCONSOLE

    style FOUNDATION fill:#c3e6cb,stroke:#2e7d32
    style AUTH fill:#c3e6cb,stroke:#2e7d32
    style AGGMETRICS fill:#c3e6cb,stroke:#2e7d32
    style INTEL fill:#c3e6cb,stroke:#2e7d32
    style ENTITIES fill:#c3e6cb,stroke:#2e7d32
    style COMMUNICATIONS fill:#c3e6cb,stroke:#2e7d32
    style EVENTRADAR fill:#c3e6cb,stroke:#2e7d32
    style PROPGRAPH fill:#e2e3e5,stroke:#6c757d
    style DECISIONCENTER fill:#e2e3e5,stroke:#6c757d
    style REPORTS fill:#e2e3e5,stroke:#6c757d
    style FINOPS fill:#c3e6cb,stroke:#2e7d32
    style SYNCCONSOLE fill:#fff3cd,stroke:#856404
```

**Como ler**: seta cheia (`-->`) = dependência forte, o módulo de origem bloqueia o de destino.
Seta pontilhada (`-.->`) = dependência fraca/opcional — o destino funciona sem a origem (com
fallback), mas fica mais completo com ela.

> 📝 **`sync-console` adicionado (2026-07-15)**, transversal/admin-only —
> depende de `foundation` (lê `sync_cursors`/`bw_sync_lock`/`sync_log`,
> nunca reimplementa a lógica de sincronização) e de `auth` (gate
> `is_admin`), mesmo padrão de dependência já usado por `finops`. Nó
> **amarelo** (`pronto` — spec aprovada, aguardando implementação),
> ainda sem nenhuma migration/Edge Function/UI escrita. Ver
> [_index.md](_index.md) e [sync-console/overview.md](sync-console/overview.md).

> ✅ **`communications` adicionado (2026-07-25)**, Sprint 2.1 — fora da sequência original de
> Sprint 2, depende de `foundation`/`auth`/`aggregated-metrics` (já implementados) e do shell de
> `intelligence-center` (páginas novas vivem no mesmo route group). Ver
> [_index.md](_index.md), "Sprint 2.1 — módulo `communications`", e
> [communications/overview.md](communications/overview.md).
>
> ✅ **`communications` passou a verde no mesmo dia (2026-07-25)** — especificado e implementado
> na mesma sessão (spec + migrations `20260726000000`/`20260726010000` + 5 Edge Functions +
> frontend completo). Ver `CLAUDE.md`, "Módulo communications (Sprint 2.1)", pro detalhe
> completo — inclusive um gap de RLS real encontrado durante a implementação (resolvido com a
> Edge Function nova `list-organization-members`) e 2 desvios deliberados do texto original da
> spec (rota dentro de `(analytics)`, sem filtro de período na lista).

> ✅ **`entities` ganhou spec própria (2026-07-13)**, nó passou de cinza (rascunho) para amarelo
> (pronto — spec aprovada, aguardando implementação). Ver [_index.md](_index.md), "O que fica fora
> do Sprint 2", e [entities/overview.md](entities/overview.md) — catálogo global (sem
> `organization_id`, decisão confirmada com o usuário), dependência fraca/opcional de
> `aggregated-metrics` (`get_authors_ranking` ganha um enriquecimento aditivo por `entity_id`,
> nunca um pré-requisito do ranking). Não bloqueia nem é bloqueado por `intelligence-center` —
> `intelligence-center/authors-and-influencers.md` (`/authors`, já implementada) já documenta a
> classificação de espectro/`entities` como gap conhecido, exatamente o que este módulo especifica.
>
> ✅ **`entities/data-model.md` implementado no mesmo dia (2026-07-13)** — schema (migration
> `20260731000000`) + seed real de 21 partidos e 593 parlamentares federais (dados oficiais de
> `dadosabertos.camara.leg.br`/`legis.senado.leg.br`, migration `20260731010000`), pedido do
> usuário. Nó **permanece amarelo**, não vira verde — `entity-registration.md` (CRUD pela UI) e
> `author-linking.md` (o `LEFT JOIN` que efetivamente liga uma Entity a um autor do ranking) ainda
> não têm código, mesmo critério já usado para não marcar um módulo verde por ter só uma parte
> pronta (ver `aggregated-metrics`/`auth` acima). Ver `entities/data-model.md` para o detalhe
> completo, inclusive o que foi deliberadamente deixado fora do seed.
>
> ✅ **`entity_accounts` dos 512 Deputados Federais populada no mesmo dia** (migration
> `20260731030000`) — fonte oficial real por deputado (`redeSocial`, Câmara), não os 81 Senadores
> (sem fonte oficial equivalente, confirmado nesta sessão). Ver `entities/data-model.md`.
>
> ✅ **Campos reorganizados no mesmo dia** (migration `20260731050000`) — `description` renomeada
> para `cargo`; `partido`/`ideologia` viraram colunas novas (a segunda é a primeira classificação
> de melhor esforço/não-oficial do módulo, ver `entities/data-model.md`). Dado já semeado
> reorganizado nas colunas novas, nada buscado de novo.
>
> ✅ **`entities/author-linking.md` implementado (2026-08-01)** — migration `20260801010000`,
> `LEFT JOIN entity_accounts`/`entities`/`entity_tags` em `get_authors_ranking`, propagado nas 7
> Edge Functions `get-page-*`/`get-narrative-detail`. Nó **permanece amarelo** — só
> `entity-registration.md` (CRUD pela UI) ainda não tem código; ver
> `intelligence-center/authors-and-influencers.md`, "Redesenho interativo", pro consumo completo
> (dispersão/breakdowns/painel de detalhe em `/authors`).
>
> ✅ **`entities` passa a verde (2026-07-15)** — `entity-registration.md` implementado: nova 3ª
> guia "Entidades" em `/admin` (ao lado de "Usuários"/"FinOps"), Edge Functions
> `create-entity`/`update-entity`/`delete-entity` (chave secreta + Bearer token, mesmo padrão já
> estabelecido pelas outras telas `/admin/*` deste projeto — desvio deliberado do texto original
> da spec, que sugeria o padrão de exceção "publicável + JWT encaminhado" de `communications`).
> Com as 3 funcionalidades do módulo (`data-model`/`author-linking`/`entity-registration`) todas
> `implementado`, `entities` como módulo inteiro sai do amarelo pela primeira vez desde que ganhou
> spec própria em 2026-07-13. Ver `entities/entity-registration.md` e `CLAUDE.md` pro detalhe
> completo.

> ✅ **`event-radar` passou a verde em 2026-07-31**, 100% `implementado` desde 2026-08-02 — as 8
> funcionalidades do módulo (`data-model`/`detection-engine`/`deduplication-grouping`/`severity`/
> `agent-orchestrator`/`volume-limits`/`schema-integration`/`aggregated-metrics-integration`/
> `frontend-highlights-feed`) estão todas `implementado`. Última peça: o widget "Radar de Eventos"
> (`frontend-highlights-feed.md`, `RecentEventsPanel` em `/overview`, janela fixa de 72h + feedback
> do analista) fechou `schema-integration.md` (que só faltava UI) depois que a "Fase B" de
> `fluxo-aggregated-metrics.md` (A1 `get_active_highlights`/A2 boost de `risk_score`/A3
> `ai-synthesis` Camada 1) já tinha destravado o bloco `highlights` no dia anterior. Ver
> `CLAUDE.md`, "Módulo `event-radar`", pro detalhe completo de cada etapa.

`threshold-engine` e `intelligent-feed` (módulos que existiam na tabela original de `_index.md`,
Sprint 3) não aparecem como nós próprios — foram **absorvidos por `event-radar`** antes de
ganhar spec própria, ver `_index.md`, "Fusão de módulos". `command-center` também não aparece
mais (removido 2026-07-13) — o único requisito real (`cases`, schema mínimo) virou dado próprio
de `intelligence-center`, ver `_index.md`, "Módulo `command-center` removido".

## 2. Legenda

| Estilo | Significado |
|---|---|
| 🟩 Verde | `implementado` — já em produção (ver `CLAUDE.md` para o estado exato de cada peça) |
| 🟨 Amarelo | `pronto` — spec aprovada, aguardando implementação |
| ⬜ Cinza | `rascunho` — spec ainda em elaboração ou nem começada, não implementar |
| Seta pontilhada | Dependência fraca/opcional (fallback existe sem o módulo de origem) |

> ✅ **`auth` passou a verde em 2026-07-13**: as 4 specs do módulo
> (`data-model.md`, `login.md`, `password-recovery.md`, `user-management.md`)
> estão todas `implementado` — `middleware.ts` + `/login` + `/forgot-password`
> + `/reset-password` + `/admin/users` + `/perfil` (fuso horário do usuário)
> + as 6 Edge Functions `admin-*` + `update-my-timezone`. Ver `CLAUDE.md`,
> "Módulo auth (Sprint 2)", pro detalhe completo de implementação.

> ✅ **`aggregated-metrics`/`intelligence-center` passaram a verde em
> 2026-07-16** (correção de doc desatualizada — este arquivo ainda dizia
> "pronto — não implementado" para os dois, mas ambos já estavam
> genuinamente implementados desde 2026-07-14/15: `sql-aggregation.md`'s 9
> functions SQL, `service-layer-aggregation.md`'s `assemblePageResponse`,
> as 6 Edge Functions `get-page-*`/`get-narrative-detail`, e as 5 páginas
> de `intelligence-center` (Executive Overview/Narrativas/Sentimento/
> Plataformas/Pautas Eleitorais) — ver `CLAUDE.md`, "aggregated-metrics
> module (Sprint 2)" e "edge-functions-per-page.md + the 5
> intelligence-center pages". `intelligence-center` fica com a ressalva
> "`cases` ainda não" (schema mínimo de ações/decisões, sem migration —
> gap #20 de `_pending.md`). ✅ **`aggregated-metrics` está 100% completo
> desde 2026-08-02** (gaps #7/#8/#9/#10 todos resolvidos — `get_active_highlights`,
> `page_narrative_synthesis`/Camada 1, `get_region_breakdown`, trends de
> plataforma/pauta) — as 10 functions SQL da spec e as 3 camadas de
> `ai-synthesis.md` (Camada 2 é exceção-só-com-justificativa por desenho,
> não um gap) estão todas implementadas.

## 3. Módulos (resumo)

| Módulo | O que é | Status | Spec |
|---|---|---|---|
| `foundation` | Sync Brandwatch → Supabase + Narrativas como entidade viva | implementado | [foundation/overview.md](foundation/overview.md) |
| `auth` | Login/recuperação de senha (Supabase Auth) + administração de usuários (admin-only) + `/perfil` (fuso horário) | implementado | [auth/overview.md](auth/overview.md) |
| `entities` | Cadastro Nacional de Entidades (partido/espectro/cargo) + vínculo aditivo com o ranking de Autores e Influenciadores | **implementado** (2026-07-15) | [entities/overview.md](entities/overview.md) |
| `intelligence-center` | As 5 páginas do frontend (Executive Overview, Narrativas, Sentimento, Plataformas, Pautas Eleitorais) + `cases` (ações/decisões, ex-`command-center`) | implementado — `cases` (schema) ainda não | [intelligence-center/overview.md](intelligence-center/overview.md) |
| `aggregated-metrics` | Envelope JSON único + SQL de agregação + Edge Functions por página, consumido pelo frontend e pela IA | implementado — 10/10 functions SQL, `ai-synthesis.md` Camadas 0/1 completas (2026-08-02); `page_cache` **desabilitado** (2026-07-14, decisão do usuário de retomar depois), ver `_pending.md` gap #34 | [aggregated-metrics/overview.md](aggregated-metrics/overview.md) |
| `communications` | Registro de Comunicações/Decisões por Narrativa + acompanhamento de impacto (sentimento/menções/risco/momentum antes vs. depois) — Sprint 2.1 | implementado | [communications/overview.md](communications/overview.md) |
| `event-radar` | Detecção estatística de picos/quedas/mudanças + 1 card de IA por evento — absorve `threshold-engine`/`intelligent-feed` | implementado (2026-08-02) — 8/8 funcionalidades, incl. widget "Radar de Eventos" na Visão Geral | [event-radar/overview.md](event-radar/overview.md) |
| `propagation-graph` | Grafo de propagação com rollup materializado completo (versão simplificada já em `intelligence-center/narratives-exploration.md`) | rascunho | — |
| `decision-center` | AI Advisors — perguntas livres/interativas do analista sobre mentions/narrativas | rascunho | — |
| `executive-reports` | Relatórios periódicos (diário/semanal/mensal/executivo/crise) | rascunho | — |
| `finops` | Painel de custo de IA (uso real, `ai_usage_log`) + custos extras cadastráveis (`manual_costs`) + previsão de fim de mês — admin-only, transversal, sem Sprint própria | implementado (2026-08-05) | [finops/overview.md](finops/overview.md) |
| `sync-console` | Observabilidade do pipeline `bw-sync` (fase atual/última+próxima sincronização/lock/rate limit por par) + execução manual de 1 fase específica sob demanda — admin-only, transversal, sem Sprint própria | pronto — não implementado (spec 2026-07-15) | [sync-console/overview.md](sync-console/overview.md) |

## Referências

- [_index.md](_index.md) — mesma informação de módulos/dependências/sprints, em tabela + texto,
  incluindo a "Sequência de implantação — Sprint 2" detalhada passo a passo.
- [event-radar/fluxo-aggregated-metrics.md](event-radar/fluxo-aggregated-metrics.md) — o único
  par de módulos com sincronismo complexo o bastante pra merecer um diagrama próprio, incl.
  `sequenceDiagram` de quando cada parte roda e a ordem de implementação 1.1–1.6 (este arquivo
  aqui não substitui aquele, é o mapa geral; aquele é o detalhe de um par específico — vive dentro
  de `event-radar/` desde 2026-07-25 por ser específico dessa integração).
