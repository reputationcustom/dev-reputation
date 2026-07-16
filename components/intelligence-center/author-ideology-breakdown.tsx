"use client";

import type { AuthorRow } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";
import { IDEOLOGY_HEX, IDEOLOGY_LABEL, IDEOLOGY_ORDER, type Ideology } from "./author-color";

// "Menções por ideologia" e "Sentimento médio por ideologia" — .dev/specs/
// intelligence-center/authors-and-influencers.md, "Redesenho interativo".
// As 5 barras ficam sempre na ordem fixa esquerda→direita (nunca reordenadas
// por valor) — é o próprio eixo político, reordenar quebraria a leitura.

const numberFormat = new Intl.NumberFormat("pt-BR", { notation: "compact" });

function sumByIdeology(authors: AuthorRow[]): Record<Ideology, number> {
  const sums = Object.fromEntries(IDEOLOGY_ORDER.map((i) => [i, 0])) as Record<Ideology, number>;
  for (const author of authors) {
    if (author.entity_ideologia && (IDEOLOGY_ORDER as readonly string[]).includes(author.entity_ideologia)) {
      sums[author.entity_ideologia as Ideology] += author.mentions;
    }
  }
  return sums;
}

// "Menções por ideologia" — clique numa barra chama onToggleIdeology, mesmo
// efeito dos chips de ideologia da toolbar (os dois controlam o mesmo
// filtro).
export function AuthorMentionsByIdeology({
  authors,
  activeIdeologies,
  onToggleIdeology,
}: {
  authors: AuthorRow[];
  activeIdeologies: Set<string>;
  onToggleIdeology: (ideology: Ideology) => void;
}) {
  const sums = sumByIdeology(authors);
  const max = Math.max(1, ...Object.values(sums));

  return (
    <div className="flex flex-col gap-2.5">
      {IDEOLOGY_ORDER.map((ideology) => {
        const value = sums[ideology];
        const pct = (value / max) * 100;
        const isActive = activeIdeologies.size === 0 || activeIdeologies.has(ideology);
        return (
          <div key={ideology} className="grid grid-cols-[100px_1fr_52px] items-center gap-2 text-xs">
            <span className="truncate text-right text-text-secondary">{IDEOLOGY_LABEL[ideology]}</span>
            <button
              type="button"
              onClick={() => onToggleIdeology(ideology)}
              className="h-5 overflow-hidden rounded bg-bg-page text-left"
              aria-label={`Filtrar por ${IDEOLOGY_LABEL[ideology]}`}
            >
              <div
                className="h-full rounded transition-[width]"
                style={{ width: `${Math.max(2, pct)}%`, backgroundColor: IDEOLOGY_HEX[ideology], opacity: isActive ? 1 : 0.35 }}
              />
            </button>
            <span className="text-right text-text-secondary">{numberFormat.format(value)}</span>
          </div>
        );
      })}
    </div>
  );
}

// "Sentimento médio por ideologia" — barra empilhada positivo/neutro/negativo
// por ideologia, só entre autores daquela ideologia com sentimento não-nulo.
// Ideologia sem nenhum autor com sentimento no filtro atual não desenha
// linha (não uma barra zerada, que se leria como "sentimento zero").
export function AuthorSentimentByIdeology({ authors }: { authors: AuthorRow[] }) {
  const rows = IDEOLOGY_ORDER.map((ideology) => {
    const group = authors.filter(
      (a) => a.entity_ideologia === ideology && a.sentiment_positive !== null && a.sentiment_neutral !== null && a.sentiment_negative !== null
    );
    if (group.length === 0) return null;
    const pos = group.reduce((sum, a) => sum + (a.sentiment_positive ?? 0), 0) / group.length;
    const neu = group.reduce((sum, a) => sum + (a.sentiment_neutral ?? 0), 0) / group.length;
    const neg = group.reduce((sum, a) => sum + (a.sentiment_negative ?? 0), 0) / group.length;
    const total = Math.max(1, pos + neu + neg);
    return { ideology, pos: (pos / total) * 100, neu: (neu / total) * 100, neg: (neg / total) * 100 };
  }).filter((row): row is { ideology: Ideology; pos: number; neu: number; neg: number } => row !== null);

  if (rows.length === 0) {
    return <EmptyState message="Sem autores com sentimento no filtro atual." />;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <div key={row.ideology} className="grid grid-cols-[100px_1fr] items-center gap-2 text-xs">
          <span className="truncate text-right text-text-secondary">{IDEOLOGY_LABEL[row.ideology]}</span>
          <div className="flex h-4 overflow-hidden rounded bg-bg-page" title={`Positivo ${row.pos.toFixed(0)}% · Neutro ${row.neu.toFixed(0)}% · Negativo ${row.neg.toFixed(0)}%`}>
            <div className="h-full bg-sentiment-positive" style={{ width: `${row.pos}%` }} />
            <div className="h-full bg-sentiment-neutral" style={{ width: `${row.neu}%` }} />
            <div className="h-full bg-sentiment-negative" style={{ width: `${row.neg}%` }} />
          </div>
        </div>
      ))}
      <div className="mt-1 flex gap-4 text-xs text-text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-sentiment-positive" aria-hidden />
          Positivo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-sentiment-neutral" aria-hidden />
          Neutro
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-sentiment-negative" aria-hidden />
          Negativo
        </span>
      </div>
    </div>
  );
}
