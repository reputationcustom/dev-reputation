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
> nota antiga em `intelligence-center/executive-overview.md` ("mapeamento exato de
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

## Cores — funcionais (sentimento, momentum, velocidade e risco)

✅ **Reescrito 2026-07-13** — os 4 scores da tabela de Narrativas
(Sentimento, Momentum, Velocidade, Risco) agora têm fórmula e faixas
definitivas em
[aggregated-metrics/sql-aggregation.md](aggregated-metrics/sql-aggregation.md),
"Scores de Narrativa" — as tabelas abaixo mapeiam cada faixa pra uma cor.
Não criar uma escala de cor paralela no frontend; sempre derivar da
faixa/score que o envelope já devolve (Princípio técnico 2).

### Sentimento (`net_sentiment`, -100 a 100, 7 faixas)

| Faixa | Rótulo | Token | Hex (texto/ícone) | Hex (fundo) |
|---:|---|---|---|---|
| ≥ +50 | Muito positivo | `sentiment-very-positive` | `#0d7a3e` | `#e0f5e9` |
| +20 a +49 | Positivo | `sentiment-positive` | `#1a9d5c` | `#eafaf1` |
| +5 a +19 | Levemente positivo | `sentiment-slightly-positive` | `#4caf7a` | `#eefaf3` |
| -4 a +4 | Neutro | `sentiment-neutral` | `#8a8f98` | `#f3f4f6` |
| -5 a -19 | Levemente negativo | `sentiment-slightly-negative` | `#e0a13e` | `#fdf3e0` |
| -20 a -49 | Negativo | `sentiment-negative` | `#e0483e` | `#fdecea` |
| ≤ -50 | Muito negativo | `sentiment-very-negative` | `#a52820` | `#fbe3e1` |

### Momentum e Velocidade (0-100, 5 faixas — mesma rampa de cor pras duas;
### a diferença visual entre elas é o ícone/seta e o rótulo, não a cor)

| Faixa | Momentum | Velocidade | Token | Hex |
|---:|---|---|---|---|
| 0–19 | Muito baixo | ↓ Encolhendo rapidamente | `intensity-1` | `#c9cdd3` |
| 20–39 | Baixo | ↘ Diminuindo | `intensity-2` | `#a8c5f5` |
| 40–59 | Moderado | → Estável | `intensity-3` | `#2f6fed` (= `accent-blue`) |
| 60–79 | Alto | ↑ Crescendo | `intensity-4` | `#f2811d` |
| 80–100 | Explosivo | ↗ Viralizando | `intensity-5` | `#e0483e` |

### Risco (`risk_score`, 0-100, 4 faixas)

✅ **Resolve a antiga ⚠️ DECISÃO PENDENTE** ("`risk_level` tem 4 valores
mas a paleta só definia 3 cores — `high` e `critical` deveriam ter tons
diferentes?") — sim, `risk-high` e `risk-critical` são tons distintos:

| Faixa | Situação | Token | Hex (texto/ícone) | Hex (fundo) |
|---:|---|---|---|---|
| 0–33 | Baixo | `risk-low` | `#1a9d5c` | `#eafaf1` |
| 34–59 | Moderado | `risk-medium` | `#e0a13e` | `#fdf3e0` |
| 60–84 | Alto | `risk-high` | `#f2811d` | `#fdf0e4` |
| 85–100 | Crítico | `risk-critical` | `#c62828` | `#fbe3e1` |

`neutral-gray` (`#c9cdd3` / `#8a8f98`) segue disponível pra outros usos
neutros fora dos 4 scores acima (ex: estado vazio, texto secundário).

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

Toda a Sprint 2 (`intelligence-center/*.md`, incl. `executive-overview.md`)
— esta é a fonte única de tokens de cor/
tipografia do produto; specs individuais não devem redefinir cores
próprias, só referenciar os tokens/buckets desta tabela.
