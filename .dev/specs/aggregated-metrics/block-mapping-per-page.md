---
tipo: feature-spec
módulo: aggregated-metrics
funcionalidade: block-mapping-per-page
status: implementado
atualizado: 2026-07-18
---

# Mapeamento de Blocos por Página

> ✅ **Implementado (2026-07-14)**: esta tabela é espelhada 1:1 pela
> constante `PAGE_BLOCKS` em
> `supabase/functions-shared-source/aggregated-metrics-service.ts` (ver
> `service-layer-aggregation.md`). `x_insights` (linha adicionada
> 2026-07-18) e a coluna `narrative_detail`/`highlights` (deliberadamente
> sem bloco `highlights`, conferido célula-a-célula em 2026-07-15) já estão
> refletidos no código. ✅ **`breakdowns` tipo `'region'` e `trends` de
> plataforma/pauta ao longo do tempo implementados (2026-07-25)** — ver
> `_pending.md` gaps #9/#10 (resolvidos) e `sql-aggregation.md`,
> `get_region_breakdown`/`get_platform_volume_trend`/`get_theme_sov_trend`.
> ⚠️ `region` em `narrative_detail` continua sempre vazio na prática —
> `bw_query_demographics_daily` não tem `category_id`, sem como escopar
> por Narrativa (limitação real da tabela de origem, não um gap de
> código).

## Objetivo

Definir exatamente quais blocos do [standard-json-envelope.md](standard-json-envelope.md) cada
Edge Function de página deve preencher. O Claude Code deve usar esta tabela como fonte da
verdade ao implementar cada `get-page-*` — não preencher blocos fora do listado, e não deixar
de preencher os marcados como obrigatórios.

## Tabela de mapeamento

> Rótulo em português = nome exibido no menu; `page` (slug em inglês, entre parênteses) = valor
> real do campo `page` do envelope e a rota correspondente — ver `overview.md`/`standard-json-envelope.md`.

| Bloco \ Página        | Visão Geral (`overview`) | Narrativas — lista (`narratives`) | Narrativa — detalhe (`narrative_detail`) | Sentimento (`sentiment`) | Plataformas (`platforms`) | Pautas Eleitorais (`themes`) | Autores (`authors`) | Alertas (`alerts`) | Relatórios (`reports`) |
|------------------------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `metrics`               | ●   | —   | —   | —   | —   | —   | —   | —   | ●   |
| `breakdowns`             | ● (sentimento) | — | ● (sentimento/plataforma/localização da narrativa) | ● (geral/plataforma/pauta/**narrativa**/região) | ● (sentimento por plataforma) | ● (sentimento por pauta) | — | — | ● |
| `trends`                 | ● (volume+sentimento) | — | ● (evolução da narrativa vs. volume geral) | ● (evolução do sentimento) | ● (volume por plataforma) | ● (SOV por pauta ao longo do tempo) | — | — | ● |
| `narratives`             | ● (top narrativas) | ● (tabela completa) | — | — | ● (narrativas dominantes por plataforma) | ● (narrativas dentro da pauta) | — | — | ● |
| `authors`                | — | — | ● (principais disseminadores) | — | ● (perfis relevantes por plataforma) | ● (autores/comunidades por pauta) | ● (ranking completo) | — | — |
| `highlights`             | ● (insights + recomendações) | — | — | ● (mudanças de sentimento) | — | ● (comparação entre períodos) | — | ● (todos os alertas ativos) | ● |
| `term_signals`           | — | — | — | ● (drivers de sentimento) | — | ● (termos emergentes) | — | — | — |
| `graph`                  | — | — | ● (obrigatório) | — | — | — | — | — | — |
| `x_insights`             | — | — | — | — | ● (Top Hashtags/Emojis/Stories/Most Mentioned X Posters) | — | — | — | — |
| `narrative_text`         | ● | — | ● | ● | ● | ● | — | — | ● |

Legenda: ● = bloco preenchido nessa página · — = bloco retorna vazio (`[]`) ou `null`.

## Regras de negócio

- `narrative_text` nas páginas marcadas acima é montado a partir dos `highlights` já existentes
  daquela página (ver [ai-synthesis.md](ai-synthesis.md)) — normalmente SEM nova chamada de IA.
  Páginas de listagem pura (`Narrativas` lista, `Autores`, `Alertas`) não geram texto — são
  tabelas/rankings, não precisam de síntese.
- `highlights` em toda página é leitura de `feed_events` (módulo `event-radar`), nunca
  cálculo próprio deste módulo — ver `get_active_highlights` em
  [sql-aggregation.md](sql-aggregation.md).
- O bloco `narratives` reaparece em 4 páginas diferentes com o mesmo formato de item, mudando
  apenas o filtro aplicado (`filters_applied`). A função SQL de origem é a mesma em todos os
  casos — ver [sql-aggregation.md](sql-aggregation.md).
- `graph` é exclusivo da página de detalhamento de narrativa (`/narratives/[id]`) e deve ser
  `null` em todas as outras — nunca calcular o grafo completo em páginas de listagem.
- Sempre que uma página nova for adicionada ao produto, o Claude Code deve primeiro preencher
  uma linha nesta tabela antes de implementar a Edge Function correspondente.

## Referências relacionadas

- [overview.md](overview.md)
- [standard-json-envelope.md](standard-json-envelope.md)
