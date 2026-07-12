"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { OrganizationsMultiSelect } from "@/components/ui/organizations-multi-select";
import type { AdminOrganization } from "./types";

export function EditOrganizationsModal({
  userName,
  organizations,
  initialSelectedIds,
  onClose,
  onSubmit,
}: {
  userName: string;
  organizations: AdminOrganization[];
  initialSelectedIds: string[];
  onClose: () => void;
  onSubmit: (organizationIds: string[]) => Promise<void>;
}) {
  const [organizationIds, setOrganizationIds] = useState<string[]>(initialSelectedIds);
  // Erro exibido junto do multi-select (único campo deste modal), não como
  // banner genérico (Regras de UX #7).
  const [organizationsError, setOrganizationsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setOrganizationsError(null);

    if (organizationIds.length === 0) {
      setOrganizationsError("Selecione ao menos uma organização");
      return;
    }

    setLoading(true);
    try {
      await onSubmit(organizationIds);
    } catch (err) {
      setOrganizationsError(
        err instanceof Error ? err.message : "Algo deu errado. Tente novamente.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={`Organizações de ${userName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <OrganizationsMultiSelect
            organizations={organizations}
            selectedIds={organizationIds}
            onChange={setOrganizationIds}
            disabled={loading}
          />
          {organizationsError && (
            <p className="text-xs text-[#e0483e]" role="alert">
              {organizationsError}
            </p>
          )}
        </div>

        <div className="mt-2 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-md border border-border-default px-4 py-2 text-sm font-medium text-text-primary hover:bg-bg-page disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || organizationIds.length === 0}
            className="flex items-center gap-2 rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {loading && <Spinner className="h-4 w-4 text-white" />}
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
}
