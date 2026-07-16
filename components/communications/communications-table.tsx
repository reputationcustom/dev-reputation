"use client";

import { useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, DEFAULT_PAGE_SIZE } from "@/components/ui/pagination";
import { formatDateTime } from "@/lib/date/format";
import type { CommunicationRow } from "@/components/communications/types";

// Tabela de Comunicações e Decisões (communications/communication-registration.md,
// "Interface (UI)") — Tipo mostra o rótulo de communication_types quando
// record_type='communication', ou "Decisão" caso contrário; Canal fica "—"
// pra Decisão (campo não existe pra esse tipo). Paginação client-side,
// mesmo padrão de users-admin-view.tsx (regra transversal #6, 10/página).
export function CommunicationsTable({
  rows,
  membersById,
  timezone,
  onEdit,
  onDelete,
  pendingIds,
}: {
  rows: CommunicationRow[];
  membersById: Map<string, string>;
  timezone: string;
  onEdit: (row: CommunicationRow) => void;
  onDelete: (row: CommunicationRow) => void;
  pendingIds: Set<string>;
}) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / DEFAULT_PAGE_SIZE));
  const visible = rows.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE);

  if (rows.length === 0) {
    return <EmptyState message="Nenhuma comunicação ou decisão registrada ainda." />;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border-default text-xs uppercase tracking-wide text-text-tertiary">
              <th className="px-3 py-2 font-bold">Narrativa</th>
              <th className="px-3 py-2 font-bold">Tipo</th>
              <th className="px-3 py-2 font-bold">Canal</th>
              <th className="px-3 py-2 font-bold">Data</th>
              <th className="px-3 py-2 font-bold">Responsável</th>
              <th className="px-3 py-2 font-bold">Ações</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const isPending = pendingIds.has(row.id);
              return (
                <tr key={row.id} className="border-b border-border-subtle">
                  <td className="px-3 py-2">
                    <Link href={`/narratives/${row.narrative_id}`} className="font-medium text-accent-blue hover:underline">
                      {row.narratives?.title ?? "—"}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-text-primary">
                    {row.record_type === "decision" ? "Decisão" : row.communication_types?.label ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{row.channel_detail ?? "—"}</td>
                  <td className="px-3 py-2 text-text-secondary">{formatDateTime(row.occurred_at, timezone)}</td>
                  <td className="px-3 py-2 text-text-secondary">
                    {row.assignee_id ? membersById.get(row.assignee_id) ?? "—" : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <Link href={`/communications/${row.narrative_id}`} className="text-accent-blue hover:underline">
                        Ver impacto
                      </Link>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => onEdit(row)}
                        className="text-text-secondary hover:text-text-primary disabled:opacity-50"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => onDelete(row)}
                        className="text-[#e0483e] hover:opacity-80 disabled:opacity-50"
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  );
}
