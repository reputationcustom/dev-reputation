import type { Highlight } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";

const SEVERITY_COLOR: Record<string, string> = {
  low: "border-risk-low bg-risk-low-bg",
  medium: "border-risk-medium bg-risk-medium-bg",
  high: "border-risk-high bg-risk-high-bg",
  critical: "border-risk-critical bg-risk-critical-bg",
};

// Bloco `highlights` — leitura de feed_events (get_active_highlights,
// escopada pelo período/filtros da página), já implementada desde
// 2026-08-02 (event-radar "Fase B"). Não usada por /overview hoje — essa
// página renderiza RecentEventsPanel (janela FIXA de 72h,
// event-radar/frontend-highlights-feed.md) no lugar; este componente fica
// disponível pra uma futura página que precise do bloco `highlights`
// genérico por período (ex: `/sentiment`/`/themes`, que já pedem esse
// bloco em PAGE_BLOCKS mas ainda não têm um widget consumindo-o).
export function HighlightsPanel({ highlights }: { highlights: Highlight[] }) {
  if (highlights.length === 0) {
    return <EmptyState message="Nenhum insight automático no período selecionado." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {highlights.map((highlight, index) => (
        <div
          key={index}
          className={`rounded-lg border-l-4 p-4 ${SEVERITY_COLOR[highlight.severity] ?? "border-border-default bg-bg-page"}`}
        >
          <p className="text-sm font-semibold text-text-primary">{highlight.title}</p>
          <p className="mt-1 text-sm text-text-secondary">{highlight.summary}</p>
        </div>
      ))}
    </div>
  );
}

// Bloco `narrative_text` — síntese de IA (ai-synthesis.md, Camadas 0/1
// implementadas). `null` só ocorre num erro de fetch (fetchNarrativeText
// sempre monta um template determinístico como fallback, ver
// aggregated-metrics-service.ts) — texto genérico abaixo cobre esse caso
// raro, não o caminho normal.
export function NarrativeTextPanel({ text }: { text: string | null }) {
  if (!text) {
    return <p className="text-sm text-text-tertiary">Síntese automática indisponível no momento.</p>;
  }
  return <p className="text-sm leading-relaxed text-text-primary">{text}</p>;
}
