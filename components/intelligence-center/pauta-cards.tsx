import type { Breakdown } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";
import { colorForGroup } from "@/lib/chart-colors";

// Grid de cards de Pauta ("Pautas Eleitorais", protótipo original
// `pautasForBars`) — nome, barra de SOV e um dot ao lado do nome, no lugar
// da lista genérica de score usada em Sentimento/Plataformas (BreakdownPanel
// tipo 'theme'). ⚠️ Sem momentum/velocidade/tendência/"principal canal"
// por pauta — `get_theme_breakdown` só devolve label/pct(SOV)/value
// (net_sentiment), sem esses campos adicionais no grão de Pauta (raiz);
// não inventados aqui (Princípio técnico 2). Sem seleção/clique por
// enquanto — a breakdown não carrega um `id` de Pauta, só o rótulo, então
// não há como escopar `get-page-themes` com `pauta_id` de forma confiável
// a partir só deste dado (ver `_pending.md` gap #17, "drill-down segue
// pendente").
// ✅ Dot recolorido pra bater com a linha do gráfico (2026-08-09), pedido
// do usuário: "pinte a bolinha que existe ao lado das pautas com a cor do
// gráfico de linhas para facilitar a leitura" — antes o dot usava
// `NetSentimentDot` (cor por sentimento, bg-sentiment-*). `colorForGroup(item.label)`
// é a MESMA function que `TrendLineChart` usa pra colorir cada série de
// "SOV por pauta ao longo do tempo" (mesmo `item.label`/título de Pauta em
// ambos os componentes — `lib/chart-colors.ts`, extraída de
// `trend-line-chart.tsx` pra ser reusada aqui), então a cor do card sempre
// bate com a cor da linha correspondente no gráfico logo abaixo.
// ✅ Ordenado por SOV decrescente (pedido do usuário, 2026-08-09) — antes
// vinha na ordem crua devolvida por `get_theme_breakdown` (sem `order by`
// explícito na função). Ordenação só de apresentação (Princípio técnico
// 2), mesmo padrão já usado por `NarrativesTable`.
export function PautaCardGrid({ breakdown, emptyMessage }: { breakdown: Breakdown | undefined; emptyMessage: string }) {
  const items = (breakdown?.items ?? []).filter((item) => item.pct > 0).sort((a, b) => b.pct - a.pct);

  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="flex flex-wrap gap-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex min-w-0 flex-1 basis-[280px] flex-col gap-2 rounded-[10px] border border-border-default bg-bg-card p-4"
        >
          <div className="flex items-center gap-2">
            <span className="font-bold text-text-primary">{item.label}</span>
            <span
              className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: colorForGroup(item.label) }}
              aria-hidden
            />
          </div>
          <div className="flex items-center gap-2.5">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-page">
              <div className="h-full bg-accent-blue" style={{ width: `${Math.max(0, Math.min(100, item.pct))}%` }} />
            </div>
            <span className="whitespace-nowrap text-xs font-semibold text-text-secondary">{item.pct}% SOV</span>
          </div>
        </div>
      ))}
    </div>
  );
}
