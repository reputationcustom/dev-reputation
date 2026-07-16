"use client";

import { useEffect, useMemo, useState } from "react";
import { useIntelligenceCenterHeader } from "@/components/intelligence-center/header-context";
import { useUserProfile } from "@/hooks/use-user-profile";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { NarrativeCombobox } from "@/components/communications/narrative-combobox";
import { CommunicationsTable } from "@/components/communications/communications-table";
import { CommunicationFormModal, type CommunicationFormValues } from "@/components/communications/communication-form-modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Toast } from "@/components/ui/toast";
import { useNarrativesList } from "@/hooks/use-narratives-list";
import { useCommunicationTypes } from "@/hooks/use-communication-types";
import { useOrganizationMembers } from "@/hooks/use-organization-members";
import { useCommunications } from "@/hooks/use-communications";
import { callFunction } from "@/lib/supabase/call-function";
import type { CommunicationRecordType, CommunicationRow } from "@/components/communications/types";

// Cadastro de Comunicações e Decisões
// (communications/communication-registration.md) — lista geral (todas as
// Narrativas da organização ativa) + formulário de cadastro/edição.
export default function CommunicationsPage() {
  // Sem filtro de período aplicado por padrão (deliberado): comunicações e
  // decisões são um registro histórico — restringir à janela curta do
  // período global (ex: "Semanal", o default do header) esconderia a
  // maior parte da lista sem nenhum sinal visual do porquê. `organizationId`
  // ainda vem do mesmo header global (organização ativa continua valendo).
  const { organizationId } = useIntelligenceCenterHeader();
  const { timezone } = useUserProfile();

  const [narrativeFilter, setNarrativeFilter] = useState("");
  const [recordTypeFilter, setRecordTypeFilter] = useState<CommunicationRecordType | "">("");
  const [typeFilter, setTypeFilter] = useState("");

  const { narratives } = useNarrativesList(organizationId);
  const { types } = useCommunicationTypes();
  const { members } = useOrganizationMembers(organizationId);
  const { status, rows, retry } = useCommunications(organizationId, {
    narrativeId: narrativeFilter || null,
    recordType: recordTypeFilter || null,
    communicationTypeId: typeFilter || null,
  });

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m.full_name ?? "Sem nome"])), [members]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CommunicationRow | null>(null);
  const [deleting, setDeleting] = useState<CommunicationRow | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  function openCreateModal() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEditModal(row: CommunicationRow) {
    setEditing(row);
    setModalOpen(true);
  }

  async function handleSubmit(values: CommunicationFormValues) {
    if (editing) {
      await callFunction("update-communication", { id: editing.id, ...values });
      setToast({ type: "success", message: values.record_type === "decision" ? "Decisão atualizada" : "Comunicação atualizada" });
    } else {
      await callFunction("create-communication", values);
      setToast({ type: "success", message: values.record_type === "decision" ? "Decisão registrada" : "Comunicação registrada" });
    }
    setModalOpen(false);
    setEditing(null);
    retry();
  }

  async function handleDelete() {
    if (!deleting) return;
    const row = deleting;
    setPendingIds((current) => new Set(current).add(row.id));
    try {
      await callFunction("delete-communication", { id: row.id });
      setToast({ type: "success", message: row.record_type === "decision" ? "Decisão excluída" : "Comunicação excluída" });
      setDeleting(null);
      retry();
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Algo deu errado. Tente novamente." });
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
    }
  }

  return (
    <>
      <PageHeaderBar
        title="Comunicações e Decisões"
        subtitle="Registre ações de comunicação e decisões por Narrativa e acompanhe o impacto no sentimento, menções, risco e momentum."
      />

      <div className="flex flex-col gap-6 p-8">
        <WidgetCard title="Todas as comunicações e decisões" status={status} onRetry={retry}>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase text-text-tertiary">Narrativa</span>
                <div className="w-56">
                  <NarrativeCombobox narratives={narratives} value={narrativeFilter} onChange={setNarrativeFilter} placeholder="Todas" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase text-text-tertiary">Tipo de registro</span>
                <select
                  value={recordTypeFilter}
                  onChange={(event) => setRecordTypeFilter(event.target.value as CommunicationRecordType | "")}
                  className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue"
                >
                  <option value="">Todos</option>
                  <option value="communication">Comunicação</option>
                  <option value="decision">Decisão</option>
                </select>
              </div>
              {recordTypeFilter !== "decision" && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase text-text-tertiary">Tipo de comunicação</span>
                  <select
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value)}
                    className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue"
                  >
                    <option value="">Todos</option>
                    {types.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={openCreateModal}
              className="rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              + Registrar
            </button>
          </div>

          <CommunicationsTable
            rows={rows}
            membersById={membersById}
            timezone={timezone}
            onEdit={openEditModal}
            onDelete={setDeleting}
            pendingIds={pendingIds}
          />
        </WidgetCard>
      </div>

      {modalOpen && (
        <CommunicationFormModal
          narratives={narratives}
          communicationTypes={types}
          members={members}
          editing={editing}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          onSubmit={handleSubmit}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Excluir registro"
          message={`Tem certeza que deseja excluir "${deleting.title}"? Esta ação não pode ser desfeita.`}
          confirmLabel="Excluir"
          loading={pendingIds.has(deleting.id)}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}

      {toast && <Toast type={toast.type} message={toast.message} />}
    </>
  );
}
