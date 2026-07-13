import type { Breakdown } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";
import { NetSentimentDot } from "./score-badges";

// Grid de cards de Pauta ("Pautas Eleitorais", protótipo original
// `pautasForBars`) — nome, barra de SOV e sentimento (dot), no lugar da
// lista genérica de score usada em Sentimento/Plataformas (BreakdownPanel
// tipo 'theme'). ⚠️ Sem momentum/velocidade/tendência/"principal canal"
// por pauta — `get_theme_breakdown` só devolve label/pct(SOV)/value
// (net_sentiment), sem esses campos adicionais no grão de Pauta (raiz);
// não inventados aqui (Princípio técnico 2). Sem seleção/clique por
// enquanto — a breakdown não carrega um `id` de Pauta, só o rótulo, então
// não há como escopar `get-page-themes` com `pauta_id` de forma confiável
// a partir só deste dado (ver `_pending.md` gap #17, "drill-down segue
// pendente").
export function PautaCardGrid({ breakdown, emptyMessage }: { breakdown: Breakdown | undefined; emptyMessage: string }) {
  const items = (breakdown?.items ?? []).filter((item) => item.pct > 0);

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
            <NetSentimentDot value={item.value} />
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
