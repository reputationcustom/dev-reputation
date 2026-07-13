import type { MetricCard as MetricCardData } from "@reputation/shared-types";
import { Tooltip } from "@/components/ui/tooltip";

// Definições simplificadas a partir da documentação oficial da Brandwatch
// (developers.brandwatch.com — chart-dimensions-and-aggregates,
// mention-metadata-field-definitions), traduzidas/resumidas pro usuário
// final (pedido do usuário 2026-07-12: "busque as melhores definições na
// documentação da Brandwatch e simplifique"). Mesma fonte já usada em
// CLAUDE.md pra confirmar que reachEstimate/engagementScore/authors/
// netSentiment são agregados oficiais, não amostrados/calculados
// localmente — o texto aqui só explica o conceito, não reimplementa nada.
const KPI_TOOLTIPS: Record<string, string> = {
  total_mentions:
    "Quantidade de publicações (posts, comentários, notícias etc.) que citaram o tema monitorado no período selecionado.",
  net_sentiment:
    "Resumo do tom das publicações: soma o % que foi positivo e subtrai o % que foi negativo. Perto de 100% é predominantemente positivo; perto de -100%, predominantemente negativo; perto de 0% é neutro ou equilibrado.",
  unique_authors:
    "Número de pessoas ou perfis diferentes que publicaram sobre o tema — cada autor é contado uma única vez, mesmo que tenha publicado várias vezes.",
  reach_estimate:
    "Estimativa de quantas pessoas podem ter visto essas publicações, com base no tamanho da audiência (ex: seguidores) de quem publicou.",
  engagement_score:
    "Soma de curtidas, comentários, compartilhamentos e outras reações que essas publicações receberam.",
};

function formatValue(value: number, unit?: string): string {
  if (unit === "net_sentiment_pct") return `${value.toFixed(1)}%`;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

// Card de KPI (bloco `metrics` do envelope) — Visão Geral/Relatórios (ver
// block-mapping-per-page.md). Delta/tendência já vêm calculados do backend
// (get_metrics_cards), o card só renderiza. Sentimento geral usa
// `net_sentiment_pct` (get_metrics_cards, migration 20260712050000): valor
// já é um score -100..100 apresentado como %, e o delta já vem calculado
// como diferença absoluta em pontos percentuais (não variação relativa —
// não faz sentido perto de zero/com troca de sinal), pedido do usuário
// 2026-07-12.
export function MetricCard({ metric }: { metric: MetricCardData }) {
  const trendColor =
    metric.trend === "up" ? "text-sentiment-positive" : metric.trend === "down" ? "text-sentiment-negative" : "text-text-tertiary";
  const trendIcon = metric.trend === "up" ? "↑" : metric.trend === "down" ? "↓" : "→";
  const isPercentagePoints = metric.unit === "net_sentiment_pct";
  const tooltipText = KPI_TOOLTIPS[metric.key];

  return (
    <div className="rounded-xl border border-border-default bg-bg-card p-5">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-tertiary">
        {metric.label}
        {tooltipText && (
          <Tooltip text={tooltipText}>
            <span
              tabIndex={0}
              aria-label={`O que é ${metric.label}`}
              className="flex h-3.5 w-3.5 flex-shrink-0 cursor-help items-center justify-center rounded-full border border-text-tertiary text-[9px] font-bold normal-case text-text-tertiary outline-none focus-visible:border-accent-blue focus-visible:text-accent-blue"
            >
              ?
            </span>
          </Tooltip>
        )}
      </p>
      <p className="mt-2 text-2xl font-bold text-text-primary">{formatValue(metric.value, metric.unit)}</p>
      {metric.delta_pct !== null && metric.delta_pct !== undefined && (
        <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${trendColor}`}>
          <span aria-hidden>{trendIcon}</span>
          {Math.abs(metric.delta_pct)}
          {isPercentagePoints ? " p.p." : "%"} vs. período anterior
        </p>
      )}
    </div>
  );
}
