import type { Breakdown, MetricCard as MetricCardData } from "@reputation/shared-types";
import { Tooltip } from "@/components/ui/tooltip";

// Definições simplificadas a partir da documentação oficial da Brandwatch
// (developers.brandwatch.com — chart-dimensions-and-aggregates,
// mention-metadata-field-definitions), traduzidas/resumidas pro usuário
// final (pedido do usuário 2026-07-12: "busque as melhores definições na
// documentação da Brandwatch e simplifique"). Mesma fonte já usada em
// CLAUDE.md pra confirmar que reachEstimate/engagementScore/authors são
// agregados oficiais, não amostrados/calculados localmente — o texto aqui
// só explica o conceito, não reimplementa nada. `net_sentiment` não entra
// mais aqui — ver KPI_TOOLTIPS em SentimentMetricCard, abaixo.
const KPI_TOOLTIPS: Record<string, string> = {
  total_mentions:
    "Quantidade de publicações (posts, comentários, notícias etc.) que citaram o tema monitorado no período selecionado.",
  unique_authors:
    "Número de pessoas ou perfis diferentes que publicaram sobre o tema — cada autor é contado uma única vez, mesmo que tenha publicado várias vezes.",
  reach_estimate:
    "Estimativa de quantas pessoas podem ter visto essas publicações, com base no tamanho da audiência (ex: seguidores) de quem publicou.",
  engagement_score:
    "Soma de curtidas, comentários, compartilhamentos e outras reações que essas publicações receberam.",
};

function formatValue(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

// Card de KPI (bloco `metrics` do envelope) — Visão Geral/Relatórios (ver
// block-mapping-per-page.md). Delta/tendência já vêm calculados do backend
// (get_metrics_cards), o card só renderiza. Não é usado para
// `metric.key === 'net_sentiment'` — ver SentimentMetricCard abaixo, que a
// página renderiza no lugar deste componente para esse card específico.
export function MetricCard({ metric }: { metric: MetricCardData }) {
  const trendColor =
    metric.trend === "up" ? "text-sentiment-positive" : metric.trend === "down" ? "text-sentiment-negative" : "text-text-tertiary";
  const trendIcon = metric.trend === "up" ? "↑" : metric.trend === "down" ? "↓" : "→";
  const tooltipText = KPI_TOOLTIPS[metric.key];
  // metric.value === null: ainda sincronizando, distinto de 0 (get_metrics_cards,
  // 20260721000000 — hoje só acontece pra reach_estimate/engagement_score/
  // unique_authors no período "Diário", quando o dia já tem menções mas essa
  // métrica em si ainda não chegou de uma chamada mais tardia de bw-sync).
  // Mostrar "0"/uma queda de -100% aqui seria um dado falso, não um "sem dado".
  const isPending = metric.value === null;

  return (
    <div className="rounded-xl border border-border-default bg-bg-card p-5">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-text-primary">
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
      {isPending ? (
        <>
          <p className="mt-2 text-2xl font-bold text-text-tertiary">—</p>
          <p className="mt-1 text-xs font-medium text-text-tertiary">Ainda sincronizando…</p>
        </>
      ) : (
        <>
          <p className="mt-2 text-2xl font-bold text-text-primary">{formatValue(metric.value as number)}</p>
          {metric.delta_pct !== null && metric.delta_pct !== undefined && (
            <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${trendColor}`}>
              <span aria-hidden>{trendIcon}</span>
              {Math.abs(metric.delta_pct)}% vs. período anterior
            </p>
          )}
        </>
      )}
    </div>
  );
}

const SENTIMENT_ORDER = ["positive", "neutral", "negative"] as const;

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

const SENTIMENT_TOOLTIP =
  "Proporção de publicações positivas, neutras e negativas sobre o tema no período selecionado — cada publicação conta uma vez, no grupo que corresponde ao seu tom predominante.";

// Card de KPI "Sentimento geral", renderizado pela página no lugar de
// MetricCard para `metric.key === 'net_sentiment'` (mesma posição na grade
// de 5 cards). Substitui a versão anterior — um único score -100..100
// apresentado como % — pela "distribuição positivo/neutro/negativo
// compacta" que executive-overview.md sempre pediu ("Cards de topo") mas
// que a implementação original não seguiu; um score isolado como "-1"
// não comunica nada sem contexto de escala, e um "aumento" de 15% na
// variação relativa de um score que pode cruzar zero é enganoso (pedido do
// usuário 2026-07-13: "definir como positivo, negativo e neutro ao invés
// de percentual"). Usa o mesmo dado já buscado para o widget "Sentimento
// geral" da página (bloco `breakdowns`, type='sentiment' —
// get_sentiment_breakdown, escopo Query inteira), não uma chamada nova —
// mesmos 3 percentuais, só uma apresentação compacta o bastante pra caber
// num card de KPI (ver SentimentBar em charts/breakdown-panel.tsx para a
// versão maior, reaproveitada no widget "Sentimento geral" abaixo da
// grade).
export function SentimentMetricCard({ breakdown }: { breakdown: Breakdown | undefined }) {
  const items = SENTIMENT_ORDER.map((key) => breakdown?.items.find((item) => item.label === key)).filter(
    (item): item is Breakdown["items"][number] => Boolean(item),
  );
  const hasData = items.some((item) => item.value > 0);

  return (
    <div className="rounded-xl border border-border-default bg-bg-card p-5">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-text-primary">
        Sentimento geral
        <Tooltip text={SENTIMENT_TOOLTIP}>
          <span
            tabIndex={0}
            aria-label="O que é Sentimento geral"
            className="flex h-3.5 w-3.5 flex-shrink-0 cursor-help items-center justify-center rounded-full border border-text-tertiary text-[9px] font-bold normal-case text-text-tertiary outline-none focus-visible:border-accent-blue focus-visible:text-accent-blue"
          >
            ?
          </span>
        </Tooltip>
      </p>
      {hasData ? (
        <>
          <div className="mt-2 flex gap-4">
            {items.map((item) => (
              <div key={item.label}>
                <div className={`text-lg font-bold ${SENTIMENT_TEXT_CLASS[item.label] ?? "text-text-primary"}`}>{item.pct}%</div>
                <div className="text-[11px] text-text-tertiary">{SENTIMENT_LABEL[item.label] ?? item.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full">
            {items.map((item) => (
              <div key={item.label} className={SENTIMENT_BG_CLASS[item.label] ?? "bg-text-tertiary"} style={{ width: `${item.pct}%` }} />
            ))}
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-text-tertiary">Nenhuma menção no período selecionado.</p>
      )}
    </div>
  );
}
