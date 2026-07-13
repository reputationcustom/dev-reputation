import { Tooltip } from "@/components/ui/tooltip";

// Mapeamento score/rótulo → cor+texto em pt-BR — nenhum threshold é
// recalculado aqui além do band de Momentum (ver nota abaixo); os rótulos
// (`sentiment_label`/`trend_label`/`risk_label`) já vêm prontos do
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

// Substitui VELOCITY_META (2026-07-22, pedido do usuário) — 3 estados em
// vez de 5, tendência estatística (regressão linear sobre 14 dias,
// get_narratives_table) em vez de snapshot 3h-vs-3h.
const TREND_META: Record<string, { label: string; arrow: string; color: string }> = {
  decreasing: { label: "Tendência de queda", arrow: "↓", color: "text-intensity-2" },
  stable: { label: "Estável", arrow: "→", color: "text-intensity-3" },
  increasing: { label: "Tendência de alta", arrow: "↑", color: "text-intensity-4" },
};

// Faixas de Momentum (0-19/20-39/40-59/60-79/80-100) — a única banda dos 4
// scores sem rótulo próprio no envelope (sentiment/trend/risk todos
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

export function TrendIndicator({ score, label }: { score: number | null; label: string | null }) {
  if (score === null || !label) return <span className="text-sm text-text-tertiary">—</span>;
  const meta = TREND_META[label] ?? TREND_META.stable;
  const rounded = Math.round(score);
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${meta.color}`}>
      <span aria-hidden>{meta.arrow}</span>
      {meta.label}
      {rounded !== 0 && <span className="text-xs opacity-70">({rounded})</span>}
    </span>
  );
}

// Versão compacta de TrendIndicator — só a seta, valor completo (rótulo +
// score) só ao passar o mouse (pedido do usuário 2026-07-25: a coluna
// "Tendência" da tabela ficava poluída com texto longo repetido em toda
// linha; a seta sozinha já comunica a direção, o resto vira detalhe sob
// demanda). Usada só em narratives-table.tsx — os outros usos de
// TrendIndicator (cabeçalho do Detalhe de Narrativa, painel de seleção)
// têm espaço de sobra e continuam mostrando o texto completo.
export function TrendArrow({ score, label }: { score: number | null; label: string | null }) {
  if (score === null || !label) return <span className="text-sm text-text-tertiary">—</span>;
  const meta = TREND_META[label] ?? TREND_META.stable;
  const rounded = Math.round(score);
  return (
    <Tooltip text={`${meta.label} (${rounded})`}>
      <span
        tabIndex={0}
        aria-label={`${meta.label}, ${rounded}`}
        className={`flex h-6 w-6 cursor-help items-center justify-center rounded-full text-base font-bold outline-none focus-visible:ring-1 focus-visible:ring-accent-blue ${meta.color}`}
      >
        {meta.arrow}
      </span>
    </Tooltip>
  );
}

// Bucket de `net_sentiment` (score bruto -100..100, breakdown
// type='platform'/'theme') pras mesmas 7 faixas de SENTIMENT_META — usado
// onde só o score existe, sem um `*_label` pronto do envelope (ex: cards
// de Pauta em themes/page.tsx). Mesmo precedente de `momentumBand` acima:
// mapeamento de apresentação sobre faixas já fechadas em
// _design-tokens.md, não um cálculo novo (Princípio técnico 2).
function sentimentBucketFromScore(score: number): keyof typeof SENTIMENT_META {
  if (score >= 50) return "very_positive";
  if (score >= 20) return "positive";
  if (score >= 5) return "slightly_positive";
  if (score >= -4) return "neutral";
  if (score >= -19) return "slightly_negative";
  if (score >= -49) return "negative";
  return "very_negative";
}

export function NetSentimentDot({ value }: { value: number }) {
  const meta = SENTIMENT_META[sentimentBucketFromScore(value)];
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${meta.text.replace("text-", "bg-")}`} title={meta.label} />;
}

// Cor de preenchimento (Tailwind `fill-*`, SVG) + rótulo em pt-BR pra um
// `net_sentiment` bruto — usado pelo mapa de "Sentimento por estado"
// (brazil-sentiment-map.tsx, pedido do usuário 2026-07-25). Mesmas 7
// faixas/cores de `SENTIMENT_META` acima, só expostas como classe `fill-`
// em vez de `text-`/`bg-` (Tailwind gera a paleta inteira `sentiment-*`
// pra toda propriedade de cor, `fill` incluso, já que a cor foi declarada
// em `theme.extend.colors`).
export function sentimentFillFromScore(score: number): { fillClass: string; label: string } {
  const meta = SENTIMENT_META[sentimentBucketFromScore(score)];
  return { fillClass: meta.text.replace("text-", "fill-"), label: meta.label };
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

// Pill de Momentum (pedido do usuário 2026-07-21, card de Narrativa) — ao
// lado do RiskBadge no cabeçalho do card, no lugar da antiga barra de
// risco em largura total. Mesmas faixas/cores de `momentumBand`
// (`bg-intensity-*`, já usadas em `ScoreBar`/`MOMENTUM_LEGEND`) — nenhuma
// paleta nova. `bg-intensity-*` não tem um par "-bg" claro/texto escuro
// como sentiment/risk (são cores sólidas mais saturadas), por isso usa
// texto branco em vez do padrão `meta.text`/`meta.bg` dos outros badges.
export function MomentumBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const band = momentumBand(score);
  const rounded = Math.round(score);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white ${band.color}`}>
      Momentum
      <span className="opacity-80">{rounded}</span>
    </span>
  );
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
