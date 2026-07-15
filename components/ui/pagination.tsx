// Padrão global (CLAUDE.md, "Regras transversais de UX"): 10 itens por
// página em toda lista, salvo quando outro valor for explicitado.
export const DEFAULT_PAGE_SIZE = 10;

// Opções do seletor de "linhas por página" (opcional, ver `onPageSizeChange`
// abaixo) — pedido do usuário, entities-admin-view.tsx (2026-07-16).
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function Pagination({
  page,
  pageCount,
  onPageChange,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  // Opcionais — só quando o consumidor passa os dois, um seletor de
  // "linhas por página" aparece ao lado de "Página X de Y". Omitidos =
  // comportamento idêntico ao de antes (nenhum outro consumidor deste
  // componente precisa mudar).
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}) {
  // Com seletor de linhas por página, o controle continua visível mesmo com
  // 1 página só — é o único jeito de o usuário reduzir o tamanho de página e
  // voltar a ter mais de uma página. Sem ele (comportamento original), some
  // exatamente como antes quando não há o que paginar.
  if (pageCount <= 1 && !onPageSizeChange) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-4 py-3 text-sm text-text-secondary">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          Página {page} de {pageCount}
        </span>
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5">
            <span className="text-text-tertiary">Linhas por página</span>
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="rounded-md border border-border-default px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-blue"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
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
