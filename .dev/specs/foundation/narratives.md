---
tipo: feature-spec
módulo: foundation
funcionalidade: narratives
status: pronto
atualizado: 2026-07-07
---

# Narratives

## Objetivo

Manter Narrativas como entidades vivas e mensuráveis — com sinais de
detecção, classificação e métricas históricas — servindo de base tanto para
a tabela interativa do Executive Overview quanto para cruzamento futuro com
Entities (Sprint 2) e para relatórios (Sprint 4).

## Usuários afetados

Analistas (leitura, via Executive Overview/Intelligence Center). Criação e
edição de Narrativas **não têm UI no Sprint 1** — ver Regras de negócio.

## Fluxo principal (dados, não UI)

1. Uma Narrativa é criada manualmente (SQL/seed) por um analista/dev, com
   `title`, opcionalmente `bw_category_id` (se já existe uma Category
   equivalente curada na Brandwatch) e/ou linhas em `narrative_signals`
   (`keyword`, `hashtag`, `author_handle`, `domain`, `url`).
2. `refresh_narrative_metrics()` roda diariamente via `pg_cron`
   (ver [data-model.md](data-model.md)):
   - Se `bw_category_id` preenchido: copia de `bw_query_metrics_daily`
     (`source = 'bw_aggregate'`).
   - Se não: agrega `mentions` que casam com `narrative_signals`, via
     `narrative_matched_mentions()` (`source = 'mentions_sample'`).
3. O Executive Overview (e futuramente Intelligence Center/relatórios) lê
   `narrative_metrics`/`reporting.narratives_overview` — nunca recalcula por
   conta própria (ver Regra de negócio abaixo).

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Narrativa sem nenhum sinal e sem `bw_category_id` | `refresh_narrative_metrics()` não gera linha para ela naquele dia (sem mentions para agregar) — Narrativa aparece na tabela com métricas zeradas/vazias, não é erro |
| Narrativa com `bw_category_id` apontando para uma Category sem `bw_query_metrics_daily` sincronizado ainda | Sem linha em `narrative_metrics` até o próximo `sync-brandwatch` popular o agregado — tratar como estado de carregamento na UI, não erro |
| Dois sinais conflitantes (ex: um `keyword` muito genérico trazendo ruído) | Fora do escopo técnico — é curadoria do analista; `weight`/`is_active` em `narrative_signals` existem para permitir desativar um sinal sem apagar o histórico |

## Interface (UI)

Não há tela de CRUD de Narrativas no Sprint 1 — só consumo (Executive
Overview, ver `executive-overview.md`). Uma tela de criação/edição de
Narrativas (gerenciar sinais, tags, vínculo com Category) é esperada no
módulo `intelligence-center` (Sprint 2), mas não está comprometida nesta
spec.

> ⚠️ DECISÃO PENDENTE: confirmar com o usuário se `intelligence-center`
> (Sprint 2) é de fato o lugar certo para o CRUD de Narrativas antes de
> especificá-lo.

## Regras de negócio

- Uma Narrativa com `bw_category_id` **sempre** usa `source = 'bw_aggregate'`
  para os números de volume/sentimento — nunca cai para agregação local
  mesmo que `narrative_signals` também exista para ela (sinais viram
  complementares/qualitativos nesse caso, não fonte do número).
- `narrative_matched_mentions()` é a **única** definição de "mentions desta
  Narrativa" — qualquer feature nova que precise desse recorte (Intelligence
  Center, `narrative_entities` no Sprint 2) reusa essa função, não
  reimplementa o matching.
- `risk_level` e `priority` são julgamento do analista (ou de uma sugestão
  de IA, no Decision Center, Sprint 3) — nunca derivados automaticamente das
  métricas.

## Dados envolvidos

- **Lê**: `bw_query_metrics_daily`, `mentions` (via `narrative_matched_mentions`).
- **Escreve**: `narratives`, `narrative_signals`, `narrative_tags` (manual/seed), `narrative_metrics` (via `refresh_narrative_metrics()`).
- Detalhes: [data-model.md](data-model.md).

## Permissões

| Ação | Quem pode |
|---|---|
| Ler Narrativas/métricas | Membros da organização (RLS) |
| Criar/editar Narrativa, sinais, tags | Manual via SQL/backend no MVP — sem policy de INSERT/UPDATE via client no Sprint 1 |

## Notificações / Feedback

Nenhuma no Sprint 1 (sem UI de gestão). Eventos de "Narrativa detectada"
automaticamente por IA (`feed_event_type = 'narrative_detected'`) são do
`intelligent-feed`/Decision Center (Sprint 3), fora deste escopo.

## Dependências técnicas

- `bw_query_metrics_daily` e `sync-brandwatch` (fonte dos agregados oficiais).
- Skill `brandwatch-api`: `references/data-restrictions-compliance.md` (por
  que sinais de texto são best-effort em X/Reddit/LinkedIn/News).

## Referências relacionadas

- [overview.md](overview.md) — validação de viabilidade completa, decisão de
  design (por que `bw_category_id` é coluna direta, não sinal EAV).
- [data-model.md](data-model.md)
- [executive-overview.md](executive-overview.md)
