"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { callFunction } from "@/lib/supabase/call-function";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination, DEFAULT_PAGE_SIZE } from "@/components/ui/pagination";
import { Toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InviteUserModal } from "./invite-user-modal";
import { EditOrganizationsModal } from "./edit-organizations-modal";
import { UserRowMenu } from "./user-row-menu";
import type { AdminOrganization, AdminUser } from "./types";

type LoadState = "loading" | "loaded" | "error";
type ModalState =
  | { type: "invite" }
  | { type: "edit-organizations"; user: AdminUser }
  | { type: "delete"; user: AdminUser }
  | null;

const SKELETON_ROWS = 5;
const SKELETON_COLUMNS = 6;

export function UsersAdminView() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<ModalState>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  // Usuários com uma ação em voo (toggle admin / revogar-restaurar) — evita
  // duplo-clique disparando a mesma ação duas vezes (Regras de UX #7).
  const [pendingUserIds, setPendingUserIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(
    null,
  );

  function setPending(userId: string, pending: boolean) {
    setPendingUserIds((current) => {
      const next = new Set(current);
      if (pending) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  const loadUsers = useCallback(async () => {
    setLoadState("loading");
    try {
      const data = await callFunction<{ users: AdminUser[]; organizations: AdminOrganization[] }>(
        "admin-list-users",
      );
      setUsers(data.users);
      setOrganizations(data.organizations);
      setPage(1);
      setLoadState("loaded");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const pageCount = Math.max(1, Math.ceil(users.length / DEFAULT_PAGE_SIZE));
  const pagedUsers = useMemo(
    () => users.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE),
    [users, page],
  );

  async function handleInvite(input: {
    email: string;
    full_name: string;
    organization_ids: string[];
    is_admin: boolean;
  }) {
    await callFunction("admin-invite-user", input);
    setModal(null);
    setToast({ type: "success", message: `Convite enviado para ${input.email}` });
    await loadUsers();
  }

  async function handleToggleAdmin(user: AdminUser, nextIsAdmin: boolean) {
    const previous = users;
    setPending(user.id, true);
    setUsers((current) =>
      current.map((item) => (item.id === user.id ? { ...item, is_admin: nextIsAdmin } : item)),
    );

    try {
      await callFunction("admin-set-user-role", { user_id: user.id, is_admin: nextIsAdmin });
      setToast({
        type: "success",
        message: nextIsAdmin
          ? `${user.full_name ?? user.email} agora é administrador`
          : `${user.full_name ?? user.email} não é mais administrador`,
      });
    } catch (err) {
      setUsers(previous);
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Algo deu errado. Tente novamente.",
      });
    } finally {
      setPending(user.id, false);
    }
  }

  async function handleSaveOrganizations(user: AdminUser, organizationIds: string[]) {
    await callFunction("admin-update-user-organizations", {
      user_id: user.id,
      organization_ids: organizationIds,
    });
    setModal(null);
    setToast({
      type: "success",
      message: `Organizações de ${user.full_name ?? user.email} atualizadas`,
    });
    await loadUsers();
  }

  async function handleToggleRevoke(user: AdminUser) {
    const revoke = !user.banned;
    setPending(user.id, true);
    try {
      await callFunction("admin-revoke-user-access", { user_id: user.id, revoke });
      setToast({
        type: "success",
        message: revoke
          ? `Acesso revogado para ${user.full_name ?? user.email}`
          : `Acesso restaurado para ${user.full_name ?? user.email}`,
      });
      await loadUsers();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Algo deu errado. Tente novamente.",
      });
    } finally {
      setPending(user.id, false);
    }
  }

  async function handleDelete(user: AdminUser) {
    setDeleteLoading(true);
    try {
      await callFunction("admin-delete-user", { user_id: user.id });
      setModal(null);
      setToast({ type: "success", message: `${user.full_name ?? user.email} foi removido` });
      await loadUsers();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Algo deu errado. Tente novamente.",
      });
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="py-6">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-text-primary">Administração de usuários</h1>
            <p className="mt-1 text-sm text-text-secondary">
              Conceda e revogue acesso à plataforma.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModal({ type: "invite" })}
            className="rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Convidar usuário
          </button>
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-border-default bg-bg-card">
          {loadState === "loading" && (
            <table className="w-full min-w-[720px] text-left text-sm">
              <tbody>
                {Array.from({ length: SKELETON_ROWS }).map((_, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-border-subtle-2 last:border-0">
                    {Array.from({ length: SKELETON_COLUMNS }).map((__, colIndex) => (
                      <td key={colIndex} className="px-4 py-3">
                        <Skeleton className="h-4 w-full max-w-[140px]" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {loadState === "error" && (
            <div className="p-6">
              <ErrorMessage message="Não foi possível carregar os usuários." onRetry={loadUsers} />
            </div>
          )}

          {loadState === "loaded" && users.length === 0 && (
            <EmptyState message="Nenhum usuário cadastrado." />
          )}

          {loadState === "loaded" && users.length > 0 && (
            <>
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-text-primary">
                    <th className="px-4 py-3 font-bold">Nome</th>
                    <th className="px-4 py-3 font-bold">E-mail</th>
                    <th className="px-4 py-3 font-bold">Organizações</th>
                    <th className="px-4 py-3 font-bold">Admin</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                    <th className="px-4 py-3 font-bold">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedUsers.map((user) => {
                    const visibleOrganizations = user.organizations.slice(0, 2);
                    const overflowCount = user.organizations.length - visibleOrganizations.length;
                    const isPending = pendingUserIds.has(user.id);

                    return (
                      <tr key={user.id} className="border-b border-border-subtle-2 last:border-0">
                        <td className="px-4 py-3 text-text-primary">
                          <div className="flex items-center gap-2">
                            {user.full_name ?? "—"}
                            {user.is_principal && (
                              <span className="rounded-full bg-accent-blue-bg px-2 py-0.5 text-xs font-medium text-accent-blue">
                                Principal
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-text-secondary">{user.email}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {visibleOrganizations.map((organization) => (
                              <span
                                key={organization.id}
                                className="rounded-full bg-bg-page px-2 py-0.5 text-xs text-text-secondary"
                              >
                                {organization.name}
                              </span>
                            ))}
                            {overflowCount > 0 && (
                              <span className="rounded-full bg-bg-page px-2 py-0.5 text-xs text-text-secondary">
                                +{overflowCount}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <label
                            className="inline-flex items-center"
                            title={
                              user.is_principal
                                ? "Não é possível alterar o admin principal"
                                : undefined
                            }
                          >
                            <input
                              type="checkbox"
                              checked={user.is_admin}
                              disabled={user.is_principal || isPending}
                              onChange={(event) => handleToggleAdmin(user, event.target.checked)}
                              className="h-4 w-4 rounded border-border-default text-accent-blue focus:ring-accent-blue disabled:opacity-50"
                            />
                          </label>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              user.banned
                                ? "bg-[#fdecea] text-[#a52820]"
                                : "bg-[#eafaf1] text-[#1a9d5c]"
                            }`}
                          >
                            {user.banned ? "Revogado" : "Ativo"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <UserRowMenu
                            isPrincipal={user.is_principal}
                            banned={user.banned}
                            disabled={isPending}
                            onEditOrganizations={() =>
                              setModal({ type: "edit-organizations", user })
                            }
                            onToggleRevoke={() => handleToggleRevoke(user)}
                            onDelete={() => setModal({ type: "delete", user })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
            </>
          )}
        </div>
      </div>

      {modal?.type === "invite" && (
        <InviteUserModal
          organizations={organizations}
          onClose={() => setModal(null)}
          onSubmit={handleInvite}
        />
      )}

      {modal?.type === "edit-organizations" && (
        <EditOrganizationsModal
          userName={modal.user.full_name ?? modal.user.email}
          organizations={organizations}
          initialSelectedIds={modal.user.organizations.map((organization) => organization.id)}
          onClose={() => setModal(null)}
          onSubmit={(organizationIds) => handleSaveOrganizations(modal.user, organizationIds)}
        />
      )}

      {modal?.type === "delete" && (
        <ConfirmDialog
          title="Excluir usuário"
          message={`Tem certeza que deseja excluir ${
            modal.user.full_name ?? modal.user.email
          }? Esta ação não pode ser desfeita.`}
          confirmLabel="Excluir"
          loading={deleteLoading}
          onConfirm={() => handleDelete(modal.user)}
          onCancel={() => setModal(null)}
        />
      )}

      {toast && <Toast type={toast.type} message={toast.message} />}
    </div>
  );
}
