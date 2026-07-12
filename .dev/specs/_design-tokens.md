---
tipo: design-tokens
atualizado: 2026-07-12
---

# Tokens de Design — Protótipo "Comunicação Inteligente"

> Fonte: protótipo de frontend "Comunicação Inteligente" (claude.ai/design,
> projeto `9a62a59b-c1f7-48b5-a05b-5d72e6f0db9a`) — a paleta bate com a
> direção visual "1a — Institucional Navy, fiel à referência" do arquivo
> irmão "Prototipo - Direções Visuais" do mesmo projeto (as outras duas
> direções exploradas, "Suave & Amigável" e "Editorial Executivo", não
> foram levadas adiante). Documentado a pedido do usuário (2026-07-12) para
> ser a fonte única de verdade de cor/tipografia da Sprint 2 — substitui a
> nota antiga em `foundation/executive-overview.md` ("mapeamento exato de
> cor fica para o skill `frontend-design` quando a UI for implementada"): a
> paleta já está definida, deixou de ser uma decisão em aberto.

## Tipografia

- **Família**: Manrope (Google Fonts), pesos 400–800.
- **Fallback**: `system-ui, sans-serif`.
- Usada uniformemente em todo o protótipo — títulos e corpo de texto, sem
  uma segunda família para heading vs. body.

## Cores — base/neutros

| Token | Hex | Uso |
|---|---|---|
| `bg-page` | `#f3f4f6` | Fundo da página |
| `bg-sidebar` | `#12203f` | Sidebar (navy) |
| `bg-sidebar-active` | `#1a2c52` | Item ativo do menu, itens interativos (rail, chevrons) |
| `bg-card` | `#ffffff` | Cards/painéis |
| `border-default` | `#e5e7eb` | Bordas padrão |
| `border-subtle` | `#eef0f2` | Divisórias sutis (ex: cabeçalho de tabela) |
| `border-subtle-2` | `#f3f4f6` | Divisórias ainda mais sutis (linhas de tabela) |
| `text-primary` | `#1a1d29` | Texto principal |
| `text-secondary` | `#6b7280` | Texto secundário |
| `text-tertiary` | `#9aa0ab` | Texto terciário/legendas |
| `text-sidebar-inactive` | `#c3cde3` | Itens inativos do menu lateral |
| `text-sidebar-section-label` | `#6b83b3` | Rótulos de seção do menu (ex: "ANÁLISES") |

## Cores — acento

| Token | Hex | Uso |
|---|---|---|
| `accent-blue` | `#2f6fed` | Marca, navegação, série "volume total"/elemento neutro-informativo em gráficos |
| `accent-blue-bg` | `#eef2ff` | Chips/badges sobre fundo claro |

## Cores — funcionais (sentimento e risco)

⚠️ Estas cores mapeiam para os buckets já definidos em
`reporting.narratives_overview`/`narrative_metrics` (`sentiment_bucket`:
`positive`/`neutral`/`negative`) e `narratives.risk_level`
(`low`/`medium`/`high`/`critical`) — ver `foundation/data-model.md` e
`foundation/overview.md` ("Tabela interativa de Narrativas"). Não criar uma
escala de cor paralela no frontend; sempre derivar do bucket que a
API/view já devolve (Princípio técnico 2 — sem lógica de negócio no
frontend).

| Token | Hex (texto/ícone) | Hex (fundo) | Bucket |
|---|---|---|---|
| `positive` / `risk-low` | `#1a9d5c` | `#eafaf1` | `sentiment_bucket = 'positive'` · `risk_level = 'low'` |
| `neutral` / `risk-medium` | `#e0a13e` (texto de status "Em andamento": `#a5720a`) | `#fdf3e0` | `sentiment_bucket = 'neutral'` · `risk_level = 'medium'` |
| `negative` / `risk-high` / `risk-critical` | `#e0483e` | `#fdecea` | `sentiment_bucket = 'negative'` · `risk_level = 'high'`/`'critical'` |
| `neutral-gray` | `#c9cdd3` / `#8a8f98` | — | Segmento "neutro" em barras empilhadas; seta de tendência estável ("→") |

⚠️ DECISÃO PENDENTE (herdada de `foundation/overview.md`): `risk_level` tem
4 valores (`low`/`medium`/`high`/`critical`), mas a paleta do protótipo só
define 3 cores funcionais (verde/âmbar/vermelho) — `high` e `critical`
usam o mesmo `#e0483e`, ou `critical` ganha um tom próprio (mais
escuro/saturado, para diferenciar visualmente do simplesmente "alto")?
Não decidido ainda — não inventar um 4º tom sem confirmar.

## Cores — plataformas

Dots/linhas identificadoras por plataforma no protótipo — **não são as
cores de marca oficiais** de cada rede, são só identificadores visuais
consistentes dentro do produto.

| Plataforma (rótulo no protótipo) | Hex | `page_type` (Brandwatch — ver `foundation/data-model.md` §5) |
|---|---|---|
| X | `#1a1d29` | `twitter` |
| Instagram | `#c2417a` | `instagram` |
| Notícias | `#2f6fed` | `news` |
| Facebook | `#3b5ba9` | `facebook` |
| YouTube | `#c23b3b` | `video` ⚠️ não confirmado, ver nota abaixo |
| TikTok | `#1f9e94` | ⚠️ não confirmado, ver nota abaixo |
| Blogs | `#8b5cf6` | `blog` |
| Fóruns | `#6b7280` | `forum` |

⚠️ **Mapeamento rótulo → `page_type` não 100% confirmado**: os valores de
`page_type` documentados em `foundation/data-model.md` (via
`page_type_breakdown` de `bw_query_topics`, confirmado contra a doc oficial
da Brandwatch) são `blog`/`facebook`/`forum`/`general`/`image`/`instagram`/
`news`/`review`/`twitter`/`video` — essa lista **não tem** um valor
"tiktok" próprio, e não está confirmado se conteúdo de YouTube/TikTok caem
todos sob `video` ou se existe granularidade adicional não documentada.
Antes de fechar esta tabela, confirmar contra dado real já sincronizado:
`select distinct page_type from bw_query_metrics_daily_by_platform`. Até
lá, tratar o dot "TikTok" como potencialmente ausente/agrupado sob outro
`page_type` no dado real — não bloqueia o resto da paleta.

## Onde isso se aplica

Toda a Sprint 2 (`foundation/executive-overview.md`,
`intelligence-center/*.md`) — esta é a fonte única de tokens de cor/
tipografia do produto; specs individuais não devem redefinir cores
próprias, só referenciar os tokens/buckets desta tabela.
