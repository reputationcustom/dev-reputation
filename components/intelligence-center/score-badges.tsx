// Mapeamento score/rótulo → cor+texto em pt-BR — nenhum threshold é
// recalculado aqui além do band de Momentum (ver nota abaixo); os rótulos
// (`sentiment_label`/`velocity_label`/`risk_label`) já vêm prontos do
// envelope (aggregated-metrics/sql-aggregation.md, "Scores de Narrativa").
// Cores de .dev/specs/_design-tokens.md.

const SENTIMENT_META: Record<string, { label: string; text: string; bg: string }> = {
  very_positive: { label: "Muito positivo", text: "text-sentiment-very-positive", bg: "bg-sentiment-very-positive-bg" },
  positive: { label: "Positivo", text: "text-sentiment-positive", bg: "bg-sentiment-positive-bg" },
  slightly_positive: { label: "Levemente positivo", text: "text-sentiment-slightly-positive", bg: "bg-sentiment-slightly-positive-bg" },
  neutral: { label: "Neutro", text: "text-sentiment-neutral", bg: "bg-sentiment-neutral-bg" },
  slightly_negative: { label: "Levemente negativo", text: "text-sentiment-slightly-negative", bg: "bg-sentiment-slightly-negative-bg" },
  negative: { label: "Negativo", text: "text-sentiment-negative", bg: "bg-sentiment-negative-bg" },
  very_negative: { label: "Muito negativo", text: "text-sentiment-very-negative", bg: "bg-sentiment-very-negative-bg" },
};

const RISK_META: Record<string, { label: string; text: string; bg: string }> = {
  low: { label: "Baixo", text: "text-risk-low", bg: "bg-risk-low-bg" },
  medium: { label: "Moderado", text: "text-risk-medium", bg: "bg-risk-medium-bg" },
  high: { label: "Alto", text: "text-risk-high", bg: "bg-risk-high-bg" },
  critical: { label: "Crítico", text: "text-risk-critical", bg: "bg-risk-critical-bg" },
};

const VELOCITY_META: Record<string, { label: string; arrow: string; color: string }> = {
  shrinking_fast: { label: "Encolhendo rapidamente", arrow: "↓", color: "text-intensity-1" },
  declining: { label: "Diminuindo", arrow: "↘", color: "text-intensity-2" },
  stable: { label: "Estável", arrow: "→", color: "text-intensity-3" },
  growing: { label: "Crescendo", arrow: "↑", color: "text-intensity-4" },
  viral: { label: "Viralizando", arrow: "↗", color: "text-intensity-5" },
};

// Faixas de Momentum (0-19/20-39/40-59/60-79/80-100) — a única banda dos 4
// scores sem rótulo próprio no envelope (sentiment/velocity/risk todos
// devolvem `*_label`; momentum só devolve o número). Thresholds copiados
// literalmente de executive-overview.md/_design-tokens.md — mapeamento de
// apresentação, não um cálculo novo.
function momentumBand(score: number): { label: string; color: string } {
  if (score < 20) return { label: "Muito baixo", color: "bg-intensity-1" };
  if (score < 40) return { label: "Baixo", color: "bg-intensity-2" };
  if (score < 60) return { label: "Moderado", color: "bg-intensity-3" };
  if (score < 80) return { label: "Alto", color: "bg-intensity-4" };
  return { label: "Explosivo", color: "bg-intensity-5" };
}

// Número secundário some quando o score arredonda pra 0 — mesmo tratamento
// de `null` (overview.md, "Premissas de visualização de dados", regra 5).
// O rótulo/cor continua aparecendo (é a informação principal do badge; 0 é
// um valor real, só o número explícito é ruído numa tabela).
export function SentimentBadge({ value, label }: { value: number | null; label: string | null }) {
  if (value === null || !label) return <span className="text-sm text-text-tertiary">—</span>;
  const meta = SENTIMENT_META[label] ?? SENTIMENT_META.neutral;
  const rounded = Math.round(value);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.bg} ${meta.text}`}>
      {meta.label}
      {rounded !== 0 && <span className="opacity-70">{rounded}</span>}
    </span>
  );
}

export function RiskBadge({ score, label }: { score: number | null; label: string | null }) {
  if (score === null || !label) return <span className="text-sm text-text-tertiary">—</span>;
  const meta = RISK_META[label] ?? RISK_META.low;
  const rounded = Math.round(score);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.bg} ${meta.text}`}>
      {meta.label}
      {rounded !== 0 && <span className="opacity-70">{rounded}</span>}
    </span>
  );
}

export function VelocityIndicator({ score, label }: { score: number | null; label: string | null }) {
  if (score === null || !label) return <span className="text-sm text-text-tertiary">—</span>;
  const meta = VELOCITY_META[label] ?? VELOCITY_META.stable;
  const rounded = Math.round(score);
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${meta.color}`}>
      <span aria-hidden>{meta.arrow}</span>
      {meta.label}
      {rounded !== 0 && <span className="text-xs opacity-70">({rounded})</span>}
    </span>
  );
}

export function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-sm text-text-tertiary">—</span>;
  const band = momentumBand(score);
  const rounded = Math.round(score);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-border-subtle-2">
        <div className={`h-full ${band.color}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
      {rounded !== 0 && <span className="text-xs text-text-secondary">{rounded}</span>}
    </div>
  );
}

export function MomentumLabel({ score }: { score: number | null }) {
  if (score === null) return <span className="text-sm text-text-tertiary">—</span>;
  return <span className="text-sm text-text-secondary">{momentumBand(score).label}</span>;
}

const RISK_LEGEND: { label: string; text: string; bg: string }[] = [
  RISK_META.low,
  RISK_META.medium,
  RISK_META.high,
  RISK_META.critical,
].map((meta) => meta);

const MOMENTUM_LEGEND = [
  { label: "Muito baixo", color: "bg-intensity-1" },
  { label: "Baixo", color: "bg-intensity-2" },
  { label: "Moderado", color: "bg-intensity-3" },
  { label: "Alto", color: "bg-intensity-4" },
  { label: "Explosivo", color: "bg-intensity-5" },
];

// Legenda das faixas de Risco/Momentum (pedido do usuário, fim da Visão
// Geral) — mesmos thresholds/cores/rótulos de RiskBadge/ScoreBar acima,
// nenhum valor novo inventado aqui.
export function ScoreLegend() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:gap-10">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase text-text-tertiary">Risco</span>
        <div className="flex flex-wrap gap-2">
          {RISK_LEGEND.map((meta) => (
            <span
              key={meta.label}
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${meta.bg} ${meta.text}`}
            >
              {meta.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase text-text-tertiary">Momentum</span>
        <div className="flex flex-wrap gap-3">
          {MOMENTUM_LEGEND.map((band) => (
            <span key={band.label} className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
              <span className={`h-2 w-2 rounded-full ${band.color}`} aria-hidden />
              {band.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
