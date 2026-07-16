// Tooltip mínimo, sem dependência nova (só CSS `group-hover`) — usado pelos
// KPIs da Visão Geral (executive-overview.md) e pelos cabeçalhos de coluna
// da tabela de Narrativas (narratives-table.tsx) pra explicar o que cada
// indicador significa ao passar o mouse. Sem JS de posicionamento: o texto
// é curto o bastante pra caber acima/abaixo do elemento sem colidir com o
// topo da página nos usos atuais.
//
// `position="bottom"` (abre pra baixo) — necessário pros cabeçalhos de
// tabela: o `<div className="overflow-x-auto">` que envolve a tabela força
// `overflow-y: auto` também (regra do CSS: só dá pra definir overflow-x
// sem cortar overflow-y se overflow-y também não for "visible"), então um
// tooltip abrindo pra cima a partir da primeira linha (cabeçalho) ficaria
// cortado por esse contêiner. Abrir pra baixo, sobre o corpo da tabela,
// nunca é cortado.
//
// `position="right"` (abre pra direita, centralizado verticalmente) —
// adicionado 2026-07-16 pro rail colapsado da Sidebar (`sidebar.tsx`): um
// tooltip `top`/`bottom` é centralizado horizontalmente sobre o próprio
// ícone (`left-1/2 -translate-x-1/2`), o que numa coluna de 64px de largura
// coleada à borda esquerda da tela cortaria a metade esquerda do tooltip
// pra fora do viewport. Abrindo à direita do ícone, o tooltip sempre cai
// sobre o conteúdo da página (que já tem espaço), nunca é cortado.
export function Tooltip({
  text,
  children,
  position = "top",
}: {
  text: string;
  children: React.ReactNode;
  position?: "top" | "bottom" | "right";
}) {
  return (
    <span className="group relative inline-flex items-center">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-20 w-56 rounded-md bg-text-primary px-3 py-2 text-xs font-normal normal-case leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${
          position === "top"
            ? "bottom-full left-1/2 mb-2 -translate-x-1/2"
            : position === "bottom"
              ? "top-full left-1/2 mt-2 -translate-x-1/2"
              : "left-full top-1/2 ml-2 -translate-y-1/2"
        }`}
      >
        {text}
      </span>
    </span>
  );
}
