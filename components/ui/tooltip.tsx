// Tooltip mínimo, sem dependência nova (só CSS `group-hover`) — usado pelos
// KPIs da Visão Geral (executive-overview.md) pra explicar o que cada
// indicador significa ao passar o mouse. Sem JS de posicionamento: o texto
// é curto o bastante pra caber acima do elemento sem colidir com o topo da
// página nos usos atuais.
export function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex items-center">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-md bg-text-primary px-3 py-2 text-xs font-normal normal-case leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
