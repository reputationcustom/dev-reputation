import type { AuthorRow } from "@reputation/shared-types";
import { dominantSentiment, SENTIMENT_HEX } from "./author-color";

// "Detratores" / "Impulsionadores positivos" dentro de "Formação e
// propagação" (.dev/specs/intelligence-center/narratives-exploration.md,
// "Detalhe (/narratives/[id])") — derivado no client, sem chamada de rede
// adicional, a partir do mesmo bloco `authors` já buscado pra "principais
// disseminadores" (get_authors_ranking, escopado à Narrativa via
// filters.narratives). Detrator = sentimento dominante negativo,
// Impulsionador positivo = sentimento dominante positivo
// (dominantSentiment(), author-color.ts — mesma lógica do badge de
// sentimento de AuthorsList), cada lista ordenada por alcance, top 5.
//
// ⚠️ Cobertura real, não uma falha: `sentiment_positive/neutral/negative`
// só é populado pelo bw-sync pros top 10 autores por volume da Query
// INTEIRA (runAuthorEnrichmentStep/bw_query_author_topics), não por
// Narrativa — então pra muitas Narrativas uma ou as duas listas podem vir
// vazias. Isso é esperado ("detratores e impulsionadores positivos, se
// houver"), nunca escondido.

const numberFormat = new Intl.NumberFormat("pt-BR");
const STANCE_LIMIT = 5;

function StanceColumn({
  title,
  authors,
  accentHex,
  emptyMessage,
}: {
  title: string;
  authors: AuthorRow[];
  accentHex: string;
  emptyMessage: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-text-primary">
        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: accentHex }} aria-hidden />
        {title}
      </p>
      {authors.length === 0 ? (
        <p className="mt-2 text-xs text-text-tertiary">{emptyMessage}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {authors.map((author) => (
            <li key={author.name} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-text-primary">{author.name}</span>
              <span className="flex-shrink-0 text-xs text-text-tertiary">{numberFormat.format(author.reach)} alcance</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DisseminationStanceLists({ authors }: { authors: AuthorRow[] }) {
  const detractors = authors
    .filter((author) => dominantSentiment(author) === "negative")
    .sort((a, b) => b.reach - a.reach)
    .slice(0, STANCE_LIMIT);
  const promoters = authors
    .filter((author) => dominantSentiment(author) === "positive")
    .sort((a, b) => b.reach - a.reach)
    .slice(0, STANCE_LIMIT);

  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
      <p className="text-xs text-text-tertiary">
        Classificação de sentimento por autor está disponível só para os principais autores por volume da Query
        (enriquecimento automático do bw-sync) — pode não cobrir todo autor listado acima.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StanceColumn
          title="Detratores"
          authors={detractors}
          accentHex={SENTIMENT_HEX.negative}
          emptyMessage="Nenhum autor com sentimento predominantemente negativo classificado neste recorte."
        />
        <StanceColumn
          title="Impulsionadores positivos"
          authors={promoters}
          accentHex={SENTIMENT_HEX.positive}
          emptyMessage="Nenhum autor com sentimento predominantemente positivo classificado neste recorte."
        />
      </div>
    </div>
  );
}
