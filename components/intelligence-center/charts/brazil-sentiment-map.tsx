import type { BreakdownItem } from "@reputation/shared-types";
import { BRAZIL_STATES, BRAZIL_MAP_VIEWBOX, type BrazilStateShape } from "@/lib/geo/brazil-states";
import { sentimentFillFromScore } from "@/components/intelligence-center/score-badges";
import { EmptyState } from "@/components/ui/empty-state";

// Mapa de "Sentimento por estado" (/sentiment) — pedido do usuário
// 2026-07-25: "Sentimento por estado pode ser representado em um mapa com
// rótulos e cores." Complementa (não substitui) a tabela com nome de
// colunas do mesmo widget (ScoreList, breakdown-panel.tsx) — o mapa dá a
// leitura geográfica de relance, a tabela dá o número exato por estado.
//
// ⚠️ Mesma ressalva já registrada em `get_region_breakdown`/
// `foundation/data-model.md`: o texto exato que a Brandwatch devolve pra
// cada estado (dimensão `regions`) nunca foi confirmado contra um payload
// real. `findState()` abaixo tenta casar por nome completo, por sigla (UF)
// e, em último caso, por substring — qualquer item que não case com
// nenhum dos 27 estados é listado abaixo do mapa em vez de descartado
// silenciosamente (mesmo princípio de honestidade já aplicado a outros
// gaps de mapeamento neste projeto).
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function findState(label: string): BrazilStateShape | undefined {
  const norm = normalize(label);
  return (
    BRAZIL_STATES.find((s) => normalize(s.name) === norm) ??
    BRAZIL_STATES.find((s) => s.code.toLowerCase() === norm) ??
    BRAZIL_STATES.find((s) => norm.includes(normalize(s.name)) || normalize(s.name).includes(norm))
  );
}

const LEGEND_SAMPLES = [
  { score: 70, label: "Muito positivo" },
  { score: 30, label: "Positivo" },
  { score: 10, label: "Levemente positivo" },
  { score: 0, label: "Neutro" },
  { score: -10, label: "Levemente negativo" },
  { score: -30, label: "Negativo" },
  { score: -70, label: "Muito negativo" },
];

export function BrazilSentimentMap({ items }: { items: BreakdownItem[] }) {
  if (items.length === 0) {
    return <EmptyState message="Nenhum dado por estado ainda." />;
  }

  const byCode = new Map<string, BreakdownItem>();
  const unmatched: BreakdownItem[] = [];
  for (const item of items) {
    const state = findState(item.label);
    if (state) {
      byCode.set(state.code, item);
    } else {
      unmatched.push(item);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="mx-auto w-full max-w-sm lg:mx-0 lg:max-w-none">
        <svg viewBox={BRAZIL_MAP_VIEWBOX} className="h-auto w-full">
          {BRAZIL_STATES.map((state) => {
            const item = byCode.get(state.code);
            const fillClass = item ? sentimentFillFromScore(item.value).fillClass : "fill-border-subtle-2";
            const title = item
              ? `${state.name}: ${item.value > 0 ? "+" : ""}${item.value} (${item.pct}% das menções)`
              : `${state.name}: sem dados`;
            return (
              <path key={state.code} d={state.path} className={`${fillClass} stroke-bg-card`} strokeWidth={1.2}>
                <title>{title}</title>
              </path>
            );
          })}
          {BRAZIL_STATES.map((state) => (
            <g key={`label-${state.code}`} className="pointer-events-none">
              <circle cx={state.cx} cy={state.cy} r={10} className="fill-bg-card" fillOpacity={0.7} />
              <text
                x={state.cx}
                y={state.cy}
                dy="0.32em"
                textAnchor="middle"
                className="fill-text-primary font-bold"
                style={{ fontSize: 9 }}
              >
                {state.code}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {LEGEND_SAMPLES.map(({ score, label }) => (
          <span key={label} className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
            <span className={`h-2.5 w-2.5 rounded-full ${sentimentFillFromScore(score).fillClass}`} aria-hidden />
            {label}
          </span>
        ))}
      </div>

      {unmatched.length > 0 && (
        <p className="text-xs text-text-tertiary">
          {unmatched.length} registro(s) não localizado(s) no mapa: {unmatched.map((item) => item.label).join(", ")}.
        </p>
      )}
    </div>
  );
}
