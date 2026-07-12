import type { DisseminationGraph } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";

const EDGE_LABEL: Record<string, string> = {
  reply: "respondeu",
  retweet: "repostou",
  mention: "citou",
};

// Grafo de disseminação simplificado (intelligence-center/narratives-exploration.md)
// — rotulado explicitamente como amostra das mentions já sincronizadas, não
// o rollup completo do futuro módulo propagation-graph (mesma exigência da
// spec). Renderizado como lista (nós por alcance + arestas), não um layout
// de força visual — simplificação desta sessão dado o volume de trabalho já
// em curso; suficiente para navegar as conexões capturadas.
export function DisseminationGraphPanel({ graph }: { graph: DisseminationGraph | null }) {
  if (!graph || graph.nodes.length === 0) {
    return <EmptyState message="Ainda não há conexões suficientes nas mentions sincronizadas." />;
  }

  const topNodes = [...graph.nodes].sort((a, b) => b.reach - a.reach).slice(0, 12);

  return (
    <div>
      <p className="text-xs text-text-tertiary">
        Amostra das conexões capturadas nas mentions já sincronizadas — não é o grafo de
        propagação completo (histórico materializado, módulo futuro).
      </p>

      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Autores (por alcance)</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {topNodes.map((node) => (
              <li key={node.id} className="flex items-center justify-between text-sm">
                <span className="truncate text-text-primary">{node.label}</span>
                <span className="text-xs text-text-tertiary">{new Intl.NumberFormat("pt-BR").format(node.reach)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Conexões</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {graph.edges.slice(0, 20).map((edge, index) => (
              <li key={index} className="text-sm text-text-secondary">
                <span className="text-text-primary">{edge.source}</span> {EDGE_LABEL[edge.type] ?? edge.type}{" "}
                <span className="text-text-primary">{edge.target}</span>
              </li>
            ))}
            {graph.edges.length === 0 && <li className="text-sm text-text-tertiary">Nenhuma conexão identificada.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
