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

// Breakdown type='narrative' — split completo (positive/neutral/negative),
// diferente de platform/theme (net_sentiment único). Uma barra empilhada por
// Narrativa, mesmo visual de SentimentBar só que repetido por linha (pedido
// do usuário 2026-07-17, "Sentimento por narrativa" — dado já existia em
// narrative_metrics, só faltava o bloco/function, ver
// get_narrative_sentiment_breakdown em sql-aggregation.md).
//
// ✅ Rótulos adicionados (2026-07-25, pedido do usuário: "inclua rótulos no
// gráfico") — antes a barra empilhada não tinha nenhum percentual visível,
// só a cor; agora mostra "pos X% neu Y% neg Z%" abaixo de cada barra, mesmo
// padrão textual já usado no NarrativeCard (narrative-card.tsx) pra manter
// consistência entre os dois lugares que mostram esse mesmo split.
function NarrativeSentimentList({ breakdown }: { breakdown: Breakdown }) {
  const items = breakdown.items.filter((item) => item.value > 0);

  if (items.length === 0) {
    return <EmptyState message="Nenhuma Narrativa com menções no período selecionado." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text-primary">{item.label}</span>
          <div className="flex h-2 overflow-hidden rounded-full">
            <div className="bg-sentiment-positive" style={{ width: `${item.positive ?? 0}%` }} />
            <div className="bg-sentiment-neutral" style={{ width: `${item.neutral ?? 0}%` }} />
            <div className="bg-sentiment-negative" style={{ width: `${item.negative ?? 0}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-text-secondary">
            <span>
              pos <b className="text-sentiment-positive">{item.positive ?? 0}%</b>
            </span>
            <span>
              neu <b className="text-sentiment-neutral">{item.neutral ?? 0}%</b>
            </span>
            <span>
              neg <b className="text-sentiment-negative">{item.negative ?? 0}%</b>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Nome da 1ª coluna por tipo de breakdown — "Sentimento por
// plataforma"/"por pauta"/"por estado" usam o mesmo ScoreList, só o nome
// do que está sendo listado muda.
const NAME_COLUMN_LABEL: Partial<Record<Breakdown["type"], string>> = {
  platform: "Plataforma",
  theme: "Pauta",
  region: "Estado",
};

// Breakdowns de type='platform'/'theme'/'region' — o `value` aqui é
// net_sentiment (score -100..100, não uma contagem/percentual), ver
// sql-aggregation.md ("get_platform_breakdown"/"get_theme_breakdown"/
// "get_region_breakdown"). Renderizado deliberadamente distinto das barras
// de sentimento acima (CLAUDE.md: "net_sentiment... precisa renderizar
// visualmente distinto") — aqui como tabela com o score e a participação
// (`pct`) em colunas próprias, não uma barra proporcional (o score pode
// ser negativo, não faz sentido como largura de barra 0-100%).
// Esconde linhas com 0% das menções — uma plataforma/pauta/estado sem
// nenhuma menção no período não agrega informação e só polui a lista
// (pedido do usuário 2026-07-12, "Sentimento por plataforma").
// ✅ Nomes de coluna adicionados (2026-07-25, pedido do usuário: "coloque
// nome de colunas na tabela Sentimento por plataforma, Sentimento por
// pauta, Sentimento por estado") — antes era uma lista sem `<thead>`
// nenhum; agora é uma `<table>` real, mesmo padrão de cabeçalho
// (`font-bold text-text-primary`, Regra 7 transversal) já usado por
// `NarrativesTable`/`XInsightsPanel`.
function ScoreList({ breakdown }: { breakdown: Breakdown }) {
  const items = breakdown.items.filter((item) => item.pct > 0);

  if (items.length === 0) {
    return <EmptyState message="Nenhuma menção no período selecionado." />;
  }

  const nameLabel = NAME_COLUMN_LABEL[breakdown.type] ?? "Nome";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-text-primary">
            <th className="py-2 pr-4 font-bold">{nameLabel}</th>
            <th className="px-4 py-2 text-right font-bold">Participação</th>
            <th className="px-4 py-2 text-right font-bold">Sentimento</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.label} className="border-b border-border-subtle-2 last:border-0">
              <td className="py-2 pr-4 text-text-primary">{item.label}</td>
              <td className="px-4 py-2 text-right text-xs text-text-tertiary">{item.pct}% das menções</td>
              <td
                className={`px-4 py-2 text-right font-semibold ${
                  item.value > 0 ? "text-sentiment-positive" : item.value < 0 ? "text-sentiment-negative" : "text-sentiment-neutral"
                }`}
              >
                {item.value > 0 ? "+" : ""}
                {item.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// "Participação por plataforma" (Plataformas, protótipo original
// `platformsForBars`) — barra horizontal proporcional ao `pct` (SOV/
// participação), cor accent-blue fixa (não é sentimento). Distinto de
// `ScoreList` acima (que mistura `pct` + `value`/net_sentiment): esse
// widget no protótipo não mostra sentimento nenhum, só participação —
// "Sentimento por plataforma" já existe como widget próprio na página de
// Sentimento, não deveria se repetir aqui.
export function PlatformParticipationBars({ breakdown, emptyMessage }: { breakdown: Breakdown | undefined; emptyMessage: string }) {
  const items = (breakdown?.items ?? []).filter((item) => item.pct > 0);

  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2.5">
          <span className="w-20 flex-none truncate text-sm font-medium text-text-primary">{item.label}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-md bg-bg-page">
            <div className="h-full bg-accent-blue" style={{ width: `${Math.max(0, Math.min(100, item.pct))}%` }} />
          </div>
          <span className="w-10 flex-none text-right text-sm font-semibold text-text-secondary">{item.pct}%</span>
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

  if (breakdown.type === "narrative") {
    return <NarrativeSentimentList breakdown={breakdown} />;
  }

  return <ScoreList breakdown={breakdown} />;
}
