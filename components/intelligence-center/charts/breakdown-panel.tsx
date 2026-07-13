import type { Breakdown } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";

const SENTIMENT_ORDER = ["positive", "neutral", "negative"];

const SENTIMENT_LABEL: Record<string, string> = {
  positive: "Positivo",
  neutral: "Neutro",
  negative: "Negativo",
};

const SENTIMENT_TEXT_CLASS: Record<string, string> = {
  positive: "text-sentiment-positive",
  neutral: "text-sentiment-neutral",
  negative: "text-sentiment-negative",
};

const SENTIMENT_BG_CLASS: Record<string, string> = {
  positive: "bg-sentiment-positive",
  neutral: "bg-sentiment-neutral",
  negative: "bg-sentiment-negative",
};

// Distribuição positivo/neutro/negativo (breakdown type='sentiment') —
// barra única acumulada (percentuais em cima, uma barra dividida
// proporcionalmente embaixo), pedido explícito do usuário 2026-07-12
// espelhando o protótipo original ("Distribuição geral") no lugar do donut
// usado antes. Não se aplica a plataforma/pauta (ver ScoreList abaixo) —
// lá o valor é net_sentiment (score, pode ser negativo), não percentual.
function SentimentBar({ breakdown }: { breakdown: Breakdown }) {
  const items = SENTIMENT_ORDER.map((key) => breakdown.items.find((item) => item.label === key)).filter(
    (item): item is Breakdown["items"][number] => Boolean(item),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-6">
        {items.map((item) => (
          <div key={item.label}>
            <div className={`text-xl font-extrabold ${SENTIMENT_TEXT_CLASS[item.label] ?? "text-text-primary"}`}>
              {item.pct}%
            </div>
            <div className="text-xs text-text-tertiary">{SENTIMENT_LABEL[item.label] ?? item.label}</div>
          </div>
        ))}
      </div>
      <div className="flex h-2 overflow-hidden rounded-full">
        {items.map((item) => (
          <div
            key={item.label}
            className={SENTIMENT_BG_CLASS[item.label] ?? "bg-text-tertiary"}
            style={{ width: `${item.pct}%` }}
          />
        ))}
      </div>
    </div>
  );
}

// Breakdowns de type='platform'/'theme' — o `value` aqui é net_sentiment
// (score -100..100, não uma contagem/percentual), ver sql-aggregation.md
// ("get_platform_breakdown"/"get_theme_breakdown"). Renderizado
// deliberadamente distinto das barras de sentimento acima (CLAUDE.md:
// "net_sentiment... precisa renderizar visualmente distinto") — aqui como
// lista com o score e a participação (`pct`) lado a lado, não uma barra
// proporcional (o score pode ser negativo, não faz sentido como largura de
// barra 0-100%).
// Esconde linhas com 0% das menções — uma plataforma/pauta sem nenhuma
// menção no período não agrega informação e só polui a lista (pedido do
// usuário 2026-07-12, "Sentimento por plataforma").
function ScoreList({ breakdown }: { breakdown: Breakdown }) {
  const items = breakdown.items.filter((item) => item.pct > 0);

  if (items.length === 0) {
    return <EmptyState message="Nenhuma menção no período selecionado." />;
  }

  return (
    <div className="flex flex-col divide-y divide-border-subtle-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between py-2 text-sm">
          <span className="text-text-primary">{item.label}</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-tertiary">{item.pct}% das menções</span>
            <span
              className={`font-semibold ${
                item.value > 0 ? "text-sentiment-positive" : item.value < 0 ? "text-sentiment-negative" : "text-sentiment-neutral"
              }`}
            >
              {item.value > 0 ? "+" : ""}
              {item.value}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function BreakdownPanel({ breakdown, emptyMessage }: { breakdown: Breakdown | undefined; emptyMessage: string }) {
  if (!breakdown || breakdown.items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  if (breakdown.type === "sentiment") {
    return <SentimentBar breakdown={breakdown} />;
  }

  return <ScoreList breakdown={breakdown} />;
}
