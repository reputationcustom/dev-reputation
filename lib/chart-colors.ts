// Cor determinística por série/grupo dinâmico (ex: um group por título de
// Pauta em "SOV por pauta ao longo do tempo", ou por page_type em "Volume
// por plataforma") — extraído de `trend-line-chart.tsx` (2026-08-09,
// pedido do usuário: "pinte a bolinha que existe ao lado das pautas com a
// cor do gráfico de linhas para facilitar a leitura") pra ser reusado por
// qualquer componente que precise da MESMA cor que uma série recebe no
// gráfico, sem duplicar a paleta/hash em dois lugares.
const GROUP_COLORS: Record<string, string> = {
  total: "#2f6fed",
  positive: "#1a9d5c",
  neutral: "#8a8f98",
  negative: "#e0483e",
  narrativa: "#2f6fed",
  geral: "#9aa0ab",
};

// Paleta de fallback pra grupos fora do mapa fixo acima — usada por séries
// dinâmicas cujos nomes não são conhecidos de antemão. Hash determinístico
// simples (mesma string sempre cai na mesma cor, estável entre re-renders
// e entre componentes diferentes que usem `colorForGroup` sobre o mesmo
// nome, ex: o card da Pauta e a linha do gráfico).
const FALLBACK_PALETTE = ["#2f6fed", "#1a9d5c", "#e0483e", "#f5a623", "#9b59b6", "#17a2b8", "#8a8f98", "#d4478e"];

function hashGroupKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash;
}

export function colorForGroup(group: string): string {
  return GROUP_COLORS[group] ?? FALLBACK_PALETTE[hashGroupKey(group) % FALLBACK_PALETTE.length];
}
