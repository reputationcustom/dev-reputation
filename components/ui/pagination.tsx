// Padrão global (CLAUDE.md, "Regras transversais de UX"): 10 itens por
// página em toda lista, salvo quando outro valor for explicitado.
export const DEFAULT_PAGE_SIZE = 10;

export function Pagination({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;

  return (
    <div className="flex items-center justify-between border-t border-border-subtle px-4 py-3 text-sm text-text-secondary">
      <span>
        Página {page} de {pageCount}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded-md border border-border-default px-3 py-1 text-text-primary hover:bg-bg-page disabled:opacity-50"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
          className="rounded-md border border-border-default px-3 py-1 text-text-primary hover:bg-bg-page disabled:opacity-50"
        >
          Próxima
        </button>
      </div>
    </div>
  );
}
