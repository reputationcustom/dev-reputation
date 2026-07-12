"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { OrganizationsMultiSelect } from "@/components/ui/organizations-multi-select";
import type { AdminOrganization } from "./types";

export function InviteUserModal({
  organizations,
  onClose,
  onSubmit,
}: {
  organizations: AdminOrganization[];
  onClose: () => void;
  onSubmit: (input: {
    email: string;
    full_name: string;
    organization_ids: string[];
    is_admin: boolean;
  }) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [organizationIds, setOrganizationIds] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  // Erros de servidor exibidos junto ao campo relevante, não só como banner
  // genérico (Regras de UX #7) — formError é só o fallback pra erro
  // realmente não atribuível a um campo (ex: falha de rede).
  const [emailError, setEmailError] = useState<string | null>(null);
  const [organizationsError, setOrganizationsError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setEmailError(null);
    setOrganizationsError(null);
    setFormError(null);

    let hasError = false;
    if (!email.trim()) {
      setEmailError("E-mail obrigatório");
      hasError = true;
    }
    if (organizationIds.length === 0) {
      setOrganizationsError("Selecione ao menos uma organização");
      hasError = true;
    }
    if (hasError) return;

    setLoading(true);
    try {
      await onSubmit({
        email: email.trim(),
        full_name: fullName.trim(),
        organization_ids: organizationIds,
        is_admin: isAdmin,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Algo deu errado. Tente novamente.";
      const lower = message.toLowerCase();
      if (lower.includes("e-mail") || lower.includes("email")) {
        setEmailError(message);
      } else if (lower.includes("organiza")) {
        setOrganizationsError(message);
      } else {
        setFormError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Convidar usuário" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {formError && (
          <p className="rounded-md bg-[#fdecea] px-3 py-2 text-sm text-[#a52820]" role="alert">
            {formError}
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="invite-email" className="text-sm font-medium text-text-primary">
            E-mail
          </label>
          <input
            id="invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={loading}
            className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
          />
          {emailError && <p className="text-xs text-[#e0483e]">{emailError}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="invite-name" className="text-sm font-medium text-text-primary">
            Nome
          </label>
          <input
            id="invite-name"
            type="text"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            disabled={loading}
            className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text-primary">Organizações</span>
          <OrganizationsMultiSelect
            organizations={organizations}
            selectedIds={organizationIds}
            onChange={setOrganizationIds}
            disabled={loading}
          />
          {organizationsError && <p className="text-xs text-[#e0483e]">{organizationsError}</p>}
        </div>

        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(event) => setIsAdmin(event.target.checked)}
            disabled={loading}
            className="h-4 w-4 rounded border-border-default text-accent-blue focus:ring-accent-blue"
          />
          É administrador?
        </label>

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
            disabled={loading}
            className="flex items-center gap-2 rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {loading && <Spinner className="h-4 w-4 text-white" />}
            Enviar convite
          </button>
        </div>
      </form>
    </Modal>
  );
}
