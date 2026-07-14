"use client";

import { useState } from "react";
import type { Highlight, PageKey } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";
import { Toast } from "@/components/ui/toast";
import { callFunction } from "@/lib/supabase/call-function";
import { useIntelligenceCenterHeader } from "@/components/intelligence-center/header-context";

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
//
// ✅ Botão "Analisar com IA" adicionado 2026-07-14 (pedido do usuário: pra
// período personalizado, a composição via IA não deve disparar sozinha —
// ver fetchNarrativeText, ctx.period.mode — só sob pedido explícito).
// `page`/`narrativeId`/`pautaId` espelham exatamente o que
// usePageEnvelope já manda pra get-page-*, pra que
// compose-narrative-synthesis resolva a mesma chave de
// page_narrative_synthesis; `onGenerated` é o `retry()` de
// usePageEnvelope — depois de compor com sucesso, a forma mais simples de
// mostrar o texto novo é reler o envelope inteiro (que agora encontra a
// linha recém-persistida na primeira tentativa), em vez de duplicar
// estado de narrative_text nesta página e na de cima.
export function NarrativeTextPanel({
  text,
  page,
  onGenerated,
  narrativeId,
  pautaId,
}: {
  text: string | null;
  page: PageKey;
  onGenerated?: () => void;
  narrativeId?: string;
  pautaId?: string;
}) {
  const { organizationId, period, periodMode } = useIntelligenceCenterHeader();
  const [isGenerating, setIsGenerating] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  async function handleGenerate() {
    if (!organizationId) return;
    setIsGenerating(true);
    try {
      const result = await callFunction<{ narrative_text: string; generated_by_ai: boolean }>(
        "compose-narrative-synthesis",
        {
          organization_id: organizationId,
          page,
          period,
          ...(narrativeId ? { narrative_id: narrativeId } : {}),
          ...(pautaId ? { pauta_id: pautaId } : {}),
        },
      );
      setToast({
        type: "success",
        message: result.generated_by_ai
          ? "Análise gerada pela IA."
          : "Sem eventos suficientes para uma análise via IA — mostrando resumo básico do período.",
      });
      onGenerated?.();
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Não foi possível gerar a análise." });
    } finally {
      setIsGenerating(false);
      setTimeout(() => setToast(null), 4000);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {text ? (
        <p className="text-sm leading-relaxed text-text-primary">{text}</p>
      ) : (
        <p className="text-sm text-text-tertiary">Síntese automática indisponível no momento.</p>
      )}
      {periodMode === "custom" && (
        <div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 rounded-md bg-accent-blue px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {isGenerating ? "Analisando…" : "Analisar período com IA"}
          </button>
        </div>
      )}
      {toast && <Toast type={toast.type} message={toast.message} />}
    </div>
  );
}
