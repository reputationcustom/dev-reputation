---
tipo: feature-spec
módulo: intelligence-center
funcionalidade: platform-analysis
status: implementado
atualizado: 2026-07-18
---

# Análise por Plataforma

> ✅ **Implementado (2026-07-18)**: "X Themes" (Top Hashtags/Top Emojis/Top
> Stories/Most Mentioned X Posters) — o que a nota "💡 Oportunidade futura"
> abaixo deixava como planejado, não desenhado. Achado numa auditoria
> pedida pelo usuário a partir de screenshots reais do dashboard nativo da
> Brandwatch: o dado (`bw_query_x_insights`) já era capturado corretamente
> desde `foundation` (2026-07-11), mas nenhuma function/bloco do envelope
> jamais o expunha — sincronizado e parado, sem nenhum consumidor a
> jusante. Fechado com `get_x_insights` (breakdown/bloco `x_insights`, só
> nesta página) — ver `aggregated-metrics/sql-aggregation.md`. Nomes de
> campo (`volume`/`tweets`/`retweets`/`impressions`/`reachEstimate`)
> reconfirmados ao vivo contra `developers.brandwatch.com/docs/twitter-insights`
> nesta sessão (iguais aos já documentados em `foundation/data-model.md`
> desde 2026-07-11/13, agora com uma segunda confirmação independente).

> Cobre "Página 4 — Análise por Plataforma" / item "10. Visualizações
> recomendadas" do documento de estrutura do protótipo. Sem protótipo
> interativo correspondente (mesma situação de `sentiment-analysis.md`).

## Objetivo

Mostrar onde (em qual canal/plataforma) a conversa está acontecendo, com que
intensidade, e quais Narrativas dominam em cada plataforma.

## Usuários afetados

Mesmo público das demais páginas deste módulo.

## Fluxo principal

1. Usuário acessa `/platforms`, mesmos filtros globais do header.
2. Widgets carregados independentemente:
   - Participação por plataforma (volume).
   - Evolução do volume por plataforma.
   - Narrativas dominantes por plataforma.
   - Velocidade de propagação por plataforma (⚠️ gap, ver abaixo).
   - Perfis relevantes (ranking de autores).
   - Conteúdos de destaque (cards de mentions específicas).
3. Engajamento médio e Autores únicos por plataforma têm captura própria
   desde 2026-07-12 (ver "Regras de negócio" abaixo) — resolvidos.

## Fluxos alternativos e erros

| Situação | Comportamento esperado |
|---|---|
| Nenhum dado de plataforma sincronizado ainda (fase `daily_metrics`/`platform_by_narrative` não rodou para o par) | `<EmptyState />` por widget |
| Falha ao carregar um widget | `<ErrorMessage retry />` isolado |

## Interface (UI)

- **Participação por plataforma**: donut/barras de
  `bw_query_metrics_daily_by_platform` (`category_id is null`, agregado por
  `page_type`) somado no período — sem gap.
- **Evolução do volume por plataforma**: série temporal, uma linha por
  `page_type`, de `bw_query_metrics_daily_by_platform.total_mentions` por
  `metric_date` — sem gap.
- **Narrativas dominantes por plataforma**: para cada `page_type`, a
  Narrativa (`category_id` preenchido) com maior `total_mentions` nesse
  `page_type` — de `bw_query_metrics_daily_by_platform` com `category_id`
  não nulo (fase `platform_by_narrative`, throttle semanal — ver
  `sync-brandwatch.md`). Sem gap, mas depende dessa fase já ter rodado para
  cada Narrativa (pode estar parcialmente populado logo após uma Narrativa
  ser criada).
- **Perfis relevantes**: ranking de `bw_query_top_authors` por
  `reach_estimate`/`impact`/`volume` (⚠️ não quebrado por plataforma — o
  endpoint Top Authors não expõe breakdown por `page_type`; mostrar como
  "perfis mais relevantes da Query/Narrativa", não "por plataforma
  específica", a menos que o autor seja filtrável por `account_type`/rede
  já capturada em `platform_stats`). ✅ **Ampliado (2026-07-12)**: quando a
  plataforma em foco for X, combinar com `bw_query_top_tweeters` — ranking
  próprio de autores de X (`data/volume/toptweeters/queries`, distinto de
  Top Authors), que pode surfacear perfis de alto alcance/poucos posts que
  o ranking cross-platform de Top Authors deixaria de fora. Ver
  `foundation/data-model.md`.
- **Domínios mais compartilhados** (não desenhado no protótipo original,
  dado novo disponível desde 2026-07-12): `bw_query_top_shared_sites` —
  distinto de "Top Sites" (de onde as mentions vêm); mede que domínios são
  mais linkados/compartilhados dentro do conteúdo. Útil como widget
  adicional desta página se o produto quiser.
- ✅ **"X Themes" implementado (2026-07-18)** — 4 listas lado a lado (Top
  Hashtags/Most Mentioned X Posters/Top Stories/Top Emojis), espelhando o
  dashboard nativo da Brandwatch mesmo shape/colunas (`Posts`/`Reposts`/
  `All Posts`/`Impressions` = `tweets`/`retweets`/`volume`/`impressions`).
  `bw_query_x_insights` (`foundation/data-model.md`, os 4 endpoints de
  `developers.brandwatch.com/docs/twitter-insights`: hashtags, emoticons,
  stories/URLs, mentioned authors) via `get_x_insights` (breakdown/bloco
  `x_insights`, ver `aggregated-metrics/sql-aggregation.md`) →
  `components/intelligence-center/x-insights-panel.tsx`. Substituiu a nota
  "💡 Oportunidade futura, não desenhada ainda" registrada em 2026-07-13 —
  o dado já estava capturado e pronto, só faltava o wiring (mesmo padrão
  do gap de "Sentimento por Narrativa" fechado um dia antes, ver
  `CLAUDE.md`). Ver também `bw_query_topics` (tematização geral, todas as
  plataformas) em [sentiment-analysis.md](sentiment-analysis.md), "Drivers
  de sentimento" — mesma ideia, escopo mais amplo, não substituída por
  esta.
- **Conteúdos de destaque**: cards com preview de mentions específicas
  (autor, plataforma, sentimento, alcance, narrativa) — dado por mention
  individual (`mentions`/`content_source`/`reach_estimate`), mesmo padrão de
  "menções relevantes" já usado em `narratives-exploration.md`.

## Regras de negócio

- **Engajamento médio por plataforma**: ✅ **Resolvido (2026-07-12,
  migration `20260712020000`)** —
  `bw_query_metrics_daily_by_platform.engagement_score`, via
  `data/engagementScore/pageTypes/days` (mesmo aggregate já usado por
  `categories` em `bw_query_metrics_daily`, trocando a dimensão).
- **Autores únicos por plataforma**: ✅ **Resolvido (mesma migration)** —
  `bw_query_metrics_daily_by_platform.unique_authors`, via
  `data/authors/pageTypes/days` (aggregate `authors`, ver nota em
  `foundation/data-model.md`).
- **Velocidade de propagação por plataforma** ("em quais redes a narrativa
  cresce mais rapidamente"): sem endpoint de chart dedicado a "velocidade"
  — não é um agregado que a Brandwatch expõe diretamente. A leitura
  compatível com a premissa do projeto é calcular a **variação percentual
  entre dois períodos** de
  `bw_query_metrics_daily_by_platform.total_mentions` (dado 100% oficial já
  capturado; a diferença entre dois números já agregados pela Brandwatch
  não é "somar sobre `mentions`", é aritmética sobre agregados) — essa é a
  interpretação adotada. A leitura alternativa, "velocidade" no sentido de
  grafo/propagação, cai no mesmo gap do grafo de propagação em
  `narratives-exploration.md` (mesma limitação, não uma nova).

## Dados envolvidos

- **Lê**: `bw_query_metrics_daily_by_platform` (Query inteira e por
  Narrativa), `bw_query_top_authors`, `mentions` (só para "Conteúdos de
  destaque").
- Nenhuma escrita.

## Permissões

Mesma tabela de `executive-overview.md`.

## Referências relacionadas

- [intelligence-center/overview.md](overview.md)
- [foundation/data-model.md](../foundation/data-model.md)
