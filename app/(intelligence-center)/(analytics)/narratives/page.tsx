"use client";

import { useState } from "react";
import Link from "next/link";
import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { NarrativesTable } from "@/components/intelligence-center/narratives-table";
import { SentimentBadge, RiskBadge, VelocityIndicator, MomentumLabel } from "@/components/intelligence-center/score-badges";

// Exploração de Narrativas — lista (`/narratives`,
// intelligence-center/narratives-exploration.md). Clique numa linha abre um
// painel de resumo abaixo da tabela sem navegar (equivalente ao estado
// `hasSelection` do protótipo); "Ver página completa"/"Ver" navegam para o
// detalhe. ⚠️ Simplificação desta sessão: o detalhe abre como página cheia
// (`/narratives/[id]`), não como modal via intercepting route — a spec
// decidiu por um modal (2026-07-12); implementar a rota interceptadora fica
// para uma sessão futura, sem mudar a navegação por link direto.
export default function NarrativesListPage() {
  const { status, envelope, retry } = usePageEnvelope("get-page-narratives");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = envelope?.narratives ?? [];
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  return (
    <>
      <PageHeaderBar title="Narrativas" subtitle="Explore todas as Narrativas em monitoramento." />

      <div className="flex flex-col gap-6 p-8">
        <WidgetCard title="Todas as Narrativas" status={status} onRetry={retry}>
          <NarrativesTable rows={rows} onRowClick={(row) => setSelectedId(row.id)} selectedId={selectedId} />
        </WidgetCard>

        {selected && (
          <div className="rounded-xl border border-border-default bg-bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text-primary">{selected.title}</h2>
              <Link
                href={`/narratives/${selected.id}`}
                className="text-sm font-medium text-accent-blue hover:underline"
              >
                Ver página completa
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-6">
              <div>
                <p className="text-xs text-text-tertiary">Sentimento</p>
                <SentimentBadge value={selected.net_sentiment} label={selected.sentiment_label} />
              </div>
              <div>
                <p className="text-xs text-text-tertiary">Risco</p>
                <RiskBadge score={selected.risk_score} label={selected.risk_label} />
              </div>
              <div>
                <p className="text-xs text-text-tertiary">Velocidade</p>
                <VelocityIndicator score={selected.velocity_score} label={selected.velocity_label} />
              </div>
              <div>
                <p className="text-xs text-text-tertiary">Momentum</p>
                <MomentumLabel score={selected.momentum_score} />
              </div>
              <div>
                <p className="text-xs text-text-tertiary">SOV</p>
                <p className="text-sm font-medium text-text-primary">
                  {selected.sov_pct === null ? "—" : `${selected.sov_pct}%`}
                </p>
              </div>
            </div>
          </div>
        )}

        {!selected && rows.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-3 rounded-xl border border-border-default bg-bg-card p-5"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-text-primary">{row.title}</h3>
                  <SentimentBadge value={row.net_sentiment} label={row.sentiment_label} />
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-text-secondary">
                  <span>
                    SOV <b className="text-text-primary">{row.sov_pct === null ? "—" : `${row.sov_pct}%`}</b>
                  </span>
                  <span className="flex items-center gap-1">
                    Momentum <MomentumLabel score={row.momentum_score} />
                  </span>
                  <VelocityIndicator score={row.velocity_score} label={row.velocity_label} />
                </div>
                <Link
                  href={`/narratives/${row.id}`}
                  className="mt-1 text-sm font-semibold text-accent-blue hover:underline"
                >
                  Explorar narrativa →
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
