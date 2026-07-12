import type { AuthorRow } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";

// Ranking de autores (bloco `authors`) — reusado em detalhe de Narrativa
// ("principais disseminadores"), Plataformas ("perfis relevantes") e Pautas
// ("autores e comunidades por pauta"). `risk_level` fica sempre `—` (ver
// sql-aggregation.md, get_authors_ranking — sem fórmula de risco por autor
// ainda).
export function AuthorsList({ authors, emptyMessage = "Ainda sincronizando autores para este escopo." }: { authors: AuthorRow[]; emptyMessage?: string }) {
  if (authors.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="flex flex-col divide-y divide-border-subtle-2">
      {authors.slice(0, 15).map((author) => (
        <div key={author.name} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-text-primary">{author.name}</span>
            {author.is_influential && (
              <span className="flex-shrink-0 rounded-full bg-accent-blue-bg px-2 py-0.5 text-xs font-medium text-accent-blue">
                Influente
              </span>
            )}
            <span className="flex-shrink-0 text-xs text-text-tertiary">{author.type}</span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-4 text-xs text-text-secondary">
            <span>{new Intl.NumberFormat("pt-BR").format(author.reach)} alcance</span>
            <span>{new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(author.engagement)} engaj.</span>
          </div>
        </div>
      ))}
    </div>
  );
}
