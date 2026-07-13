import type { AuthorRow } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";

// Ranking de autores (bloco `authors`) — reusado em detalhe de Narrativa
// ("principais disseminadores"), Plataformas ("perfis relevantes") e Pautas
// ("autores e comunidades por pauta"). `risk_level` fica sempre `—` (ver
// sql-aggregation.md, get_authors_ranking — sem fórmula de risco por autor
// ainda).
//
// Badge de sentimento (positivo/neutro/negativo dominante do autor) só
// aparece quando os 3 campos vêm preenchidos — na prática, só os top 10
// autores por volume da Query inteira (enriquecidos via
// bw_query_author_topics, ver sql-aggregation.md/data-model.md). `null` pra
// um autor fora desse recorte não é "sem sentimento" — é "ainda não
// enriquecido", por isso o badge simplesmente não aparece, nunca mostra um
// valor inventado.
function dominantSentiment(author: AuthorRow): "positive" | "neutral" | "negative" | null {
  const { sentiment_positive, sentiment_neutral, sentiment_negative } = author;
  if (sentiment_positive === null || sentiment_neutral === null || sentiment_negative === null) return null;
  if (sentiment_positive === 0 && sentiment_neutral === 0 && sentiment_negative === 0) return null;
  if (sentiment_positive >= sentiment_neutral && sentiment_positive >= sentiment_negative) return "positive";
  if (sentiment_negative >= sentiment_neutral && sentiment_negative >= sentiment_positive) return "negative";
  return "neutral";
}

const SENTIMENT_BADGE_CLASS: Record<"positive" | "neutral" | "negative", string> = {
  positive: "bg-sentiment-positive-bg text-sentiment-positive",
  neutral: "bg-sentiment-neutral-bg text-sentiment-neutral",
  negative: "bg-sentiment-negative-bg text-sentiment-negative",
};

const SENTIMENT_BADGE_LABEL: Record<"positive" | "neutral" | "negative", string> = {
  positive: "Sentimento positivo",
  neutral: "Sentimento neutro",
  negative: "Sentimento negativo",
};

export function AuthorsList({ authors, emptyMessage = "Ainda sincronizando autores para este escopo." }: { authors: AuthorRow[]; emptyMessage?: string }) {
  if (authors.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="flex flex-col divide-y divide-border-subtle-2">
      {authors.slice(0, 15).map((author) => {
        const sentiment = dominantSentiment(author);
        return (
          <div key={author.name} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-text-primary">{author.name}</span>
              {author.is_influential && (
                <span className="flex-shrink-0 rounded-full bg-accent-blue-bg px-2 py-0.5 text-xs font-medium text-accent-blue">
                  Influente
                </span>
              )}
              {sentiment && (
                <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${SENTIMENT_BADGE_CLASS[sentiment]}`}>
                  {SENTIMENT_BADGE_LABEL[sentiment]}
                </span>
              )}
              <span className="flex-shrink-0 text-xs text-text-tertiary">{author.type}</span>
            </div>
            <div className="flex flex-shrink-0 items-center gap-4 text-xs text-text-secondary">
              <span>{new Intl.NumberFormat("pt-BR").format(author.reach)} alcance</span>
              <span>{new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(author.engagement)} engaj.</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
