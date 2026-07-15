"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { callFunction } from "@/lib/supabase/call-function";
import { ErrorMessage } from "@/components/ui/error-message";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination, DEFAULT_PAGE_SIZE } from "@/components/ui/pagination";
import { Toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useSortableRows, SortableTh } from "@/components/ui/sortable-th";
import { EntityFormModal } from "./entity-form-modal";
import { EntityDetailPanel } from "./entity-detail-panel";
import {
  ENTITY_TYPE_LABEL,
  ENTITY_TYPE_OPTIONS,
  IDEOLOGIA_LABEL,
  IDEOLOGIA_OPTIONS,
  INFLUENCE_LEVEL_LABEL,
  type Entity,
  type EntityFormValues,
  type EntityType,
} from "./types";

type LoadState = "loading" | "loaded" | "error";
type ModalState =
  | { type: "create" }
  | { type: "edit"; entity: Entity }
  | { type: "delete"; entity: Entity }
  | { type: "deactivate"; entity: Entity }
  | null;

const SKELETON_ROWS = 5;
const SKELETON_COLUMNS = 8;

type SortKey = "name" | "type" | "cargo" | "partido" | "ideologia" | "influence_level" | "accounts" | "is_active";

// Ranking pra colunas ordinais (não alfabéticas por natureza) — ideologia
// segue a ordem esquerda→direita já fixada em IDEOLOGIA_OPTIONS, influência
// segue a ordem crescente do próprio severity_level. `accounts`/`is_active`
// já são numéricos/booleanos, sem necessidade de rank.
const IDEOLOGIA_RANK: Record<string, number> = Object.fromEntries(
  IDEOLOGIA_OPTIONS.map((value, index) => [value, index]),
);
const INFLUENCE_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

function sortValueFor(entity: Entity, key: SortKey): string | number | null {
  switch (key) {
    case "name":
      return entity.name;
    case "type":
      return ENTITY_TYPE_LABEL[entity.type];
    case "cargo":
      return entity.cargo;
    case "partido":
      return entity.partido;
    case "ideologia":
      return entity.ideologia ? (IDEOLOGIA_RANK[entity.ideologia] ?? 99) : null;
    case "influence_level":
      return entity.influence_level ? INFLUENCE_RANK[entity.influence_level] : null;
    case "accounts":
      return entity.accounts.length;
    case "is_active":
      return entity.is_active ? 1 : 0;
  }
}

function EntityTypeBadge({ type }: { type: EntityType }) {
  return (
    <span className="inline-flex items-center rounded-full bg-bg-page px-2.5 py-1 text-xs font-medium text-text-secondary">
      {ENTITY_TYPE_LABEL[type]}
    </span>
  );
}

function IdeologiaBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-sm text-text-tertiary">—</span>;
  return (
    <span className="inline-flex items-center rounded-full bg-ideology-center-bg px-2.5 py-1 text-xs font-medium text-ideology-center">
      {IDEOLOGIA_LABEL[value] ?? value}
    </span>
  );
}

const INFLUENCE_BADGE_CLASS: Record<string, string> = {
  low: "bg-risk-low-bg text-risk-low",
  medium: "bg-risk-medium-bg text-risk-medium",
  high: "bg-risk-high-bg text-risk-high",
  critical: "bg-risk-critical-bg text-risk-critical",
};

// Rótulo próprio (Baixa/Média/Alta/Muito alta), não RiskBadge — mesmo valor
// de banco (severity_level) que risk_label de Narrativa, semântica de
// exibição diferente (entity-registration.md, "Interface").
function InfluenceBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-sm text-text-tertiary">—</span>;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${INFLUENCE_BADGE_CLASS[value] ?? ""}`}>
      {INFLUENCE_LEVEL_LABEL[value as keyof typeof INFLUENCE_LEVEL_LABEL] ?? value}
    </span>
  );
}

// Cadastro Nacional de Entidades (.dev/specs/entities/entity-registration.md)
// — admin-only. Leitura direta via supabase-js (RLS abre SELECT a qualquer
// autenticado, catálogo global) + 3 Edge Functions para escrita
// (create/update/delete-entity), mesmo padrão de UsersAdminView/
// FinopsAdminView.
//
// ✅ 3 melhorias de UX pedidas pelo usuário (2026-07-16), depois do CRUD já
// implementado: (1) seletor de linhas por página; (2) selecionar uma linha
// mostra o conteúdo da Entidade ao lado, sem precisar abrir "Editar" (mesmo
// mecanismo já usado em /narratives — ver EntityDetailPanel); (3) ordenação
// por qualquer coluna, clicando no cabeçalho — extraído pra um hook/
// componente compartilhado (components/ui/sortable-th.tsx, ver CLAUDE.md,
// Regras transversais de UX #11) pra virar o padrão de toda tabela nova.
export function EntitiesAdminView() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [modal, setModal] = useState<ModalState>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [conflictAccount, setConflictAccount] = useState<{ platform: string; username: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<EntityType | "">("");
  const [partidoFilter, setPartidoFilter] = useState("");
  const [ideologiaFilter, setIdeologiaFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  // Pedido do usuário: localizar rapidamente Entidades ainda sem nenhuma
  // conta cadastrada (candidatas a enriquecer com Contas nas redes, o que
  // habilita o vínculo com o ranking de Autores — ver author-linking.md).
  const [onlyWithoutAccounts, setOnlyWithoutAccounts] = useState(false);

  function setPending(id: string, pending: boolean) {
    setPendingIds((current) => {
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const load = useCallback(async () => {
    setLoadState("loading");
    const supabase = createClient();
    const [entitiesResult, accountsResult, tagsResult] = await Promise.all([
      supabase
        .from("entities")
        .select("id, type, name, cargo, partido, ideologia, photo_url, influence_level, is_active")
        .order("name", { ascending: true }),
      supabase.from("entity_accounts").select("id, entity_id, platform, username, url"),
      supabase.from("entity_tags").select("id, entity_id, tag_type, tag_value"),
    ]);

    if (entitiesResult.error || accountsResult.error || tagsResult.error) {
      setLoadState("error");
      return;
    }

    const accountsByEntity = new Map<string, Entity["accounts"]>();
    for (const row of accountsResult.data ?? []) {
      const list = accountsByEntity.get(row.entity_id) ?? [];
      list.push({ id: row.id, platform: row.platform, username: row.username, url: row.url });
      accountsByEntity.set(row.entity_id, list);
    }

    const tagsByEntity = new Map<string, Entity["tags"]>();
    for (const row of tagsResult.data ?? []) {
      const list = tagsByEntity.get(row.entity_id) ?? [];
      list.push({ id: row.id, tag_type: row.tag_type, tag_value: row.tag_value });
      tagsByEntity.set(row.entity_id, list);
    }

    const merged: Entity[] = (entitiesResult.data ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      cargo: row.cargo,
      partido: row.partido,
      ideologia: row.ideologia,
      photo_url: row.photo_url,
      influence_level: row.influence_level,
      is_active: row.is_active,
      accounts: accountsByEntity.get(row.id) ?? [],
      tags: tagsByEntity.get(row.id) ?? [],
    }));

    setEntities(merged);
    setPage(1);
    setLoadState("loaded");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const knownParties = useMemo(
    () =>
      Array.from(new Set(entities.filter((e) => e.type === "party").map((e) => e.name))).sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [entities],
  );

  const knownTagValuesByType = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const entity of entities) {
      for (const tag of entity.tags) {
        if (!map[tag.tag_type]) map[tag.tag_type] = new Set();
        map[tag.tag_type].add(tag.tag_value);
      }
    }
    const result: Record<string, string[]> = {};
    for (const [tagType, values] of Object.entries(map)) {
      result[tagType] = Array.from(values).sort((a, b) => a.localeCompare(b, "pt-BR"));
    }
    return result;
  }, [entities]);

  const knownPartidoFilters = useMemo(
    () =>
      Array.from(new Set(entities.map((e) => e.partido).filter((v): v is string => Boolean(v)))).sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [entities],
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entities.filter((entity) => {
      if (!showInactive && !entity.is_active) return false;
      if (q && !entity.name.toLowerCase().includes(q)) return false;
      if (typeFilter && entity.type !== typeFilter) return false;
      if (partidoFilter && entity.partido !== partidoFilter) return false;
      if (ideologiaFilter && entity.ideologia !== ideologiaFilter) return false;
      if (onlyWithoutAccounts && entity.accounts.length > 0) return false;
      return true;
    });
  }, [entities, searchQuery, typeFilter, partidoFilter, ideologiaFilter, showInactive, onlyWithoutAccounts]);

  // Ordenação por qualquer coluna (padrão de toda tabela do sistema, ver
  // components/ui/sortable-th.tsx) — sem ordenação inicial, preserva a
  // ordem alfabética já vinda da query (`order by name`).
  const { sort, sortedRows: sortedEntities, toggleSort } = useSortableRows<Entity, SortKey>(filtered, sortValueFor);

  const pageCount = Math.max(1, Math.ceil(sortedEntities.length / pageSize));
  const pagedEntities = useMemo(
    () => sortedEntities.slice((page - 1) * pageSize, page * pageSize),
    [sortedEntities, page, pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [searchQuery, typeFilter, partidoFilter, ideologiaFilter, showInactive, onlyWithoutAccounts, pageSize, sort]);

  // Entidade selecionada pra o painel lateral — busca no array completo
  // (não só a página/filtro atuais), pra sobreviver a uma troca de
  // filtro/página/ordenação e refletir automaticamente qualquer edição
  // salva (load() é chamado de novo, este `find` já lê o dado atualizado).
  const selectedEntity = useMemo(() => entities.find((e) => e.id === selectedId) ?? null, [entities, selectedId]);

  function handleRowClick(entity: Entity) {
    setSelectedId((current) => (current === entity.id ? null : entity.id));
  }

  function toEdgeFunctionBody(values: EntityFormValues) {
    return {
      type: values.type,
      name: values.name,
      cargo: values.cargo || null,
      partido: values.partido || null,
      ideologia: values.ideologia || null,
      photo_url: values.photo_url || null,
      influence_level: values.influence_level || null,
      accounts: values.accounts,
      tags: values.tags,
    };
  }

  async function handleCreate(values: EntityFormValues) {
    setConflictAccount(null);
    try {
      await callFunction("create-entity", toEdgeFunctionBody(values));
    } catch (err) {
      const conflict = (err as { conflict_account?: { platform: string; username: string } } | undefined)
        ?.conflict_account;
      if (conflict) setConflictAccount(conflict);
      throw err;
    }
    setModal(null);
    setToast({ type: "success", message: `Entidade ${values.name} cadastrada` });
    await load();
  }

  async function handleUpdate(entity: Entity, values: EntityFormValues) {
    setConflictAccount(null);
    try {
      await callFunction("update-entity", { id: entity.id, ...toEdgeFunctionBody(values) });
    } catch (err) {
      const conflict = (err as { conflict_account?: { platform: string; username: string } } | undefined)
        ?.conflict_account;
      if (conflict) setConflictAccount(conflict);
      throw err;
    }
    setModal(null);
    setToast({ type: "success", message: `Entidade ${values.name} atualizada` });
    await load();
  }

  // Reativar não pede confirmação (ação reversível/segura); Desativar pede
  // — ver o botão "Desativar" abaixo, que sempre abre o ConfirmDialog em vez
  // de chamar esta function direto. `onSuccess` fecha esse modal quando a
  // chamada é feita a partir dele (omitido no caminho direto de Reativar).
  async function handleToggleActive(entity: Entity, options?: { onSuccess?: () => void }) {
    const nextActive = !entity.is_active;
    setPending(entity.id, true);
    try {
      await callFunction("update-entity", { id: entity.id, is_active: nextActive });
      setToast({
        type: "success",
        message: nextActive ? `${entity.name} reativada` : `${entity.name} desativada`,
      });
      await load();
      options?.onSuccess?.();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Algo deu errado. Tente novamente.",
      });
    } finally {
      setPending(entity.id, false);
    }
  }

  async function handleDelete(entity: Entity) {
    setDeleteLoading(true);
    try {
      await callFunction("delete-entity", { id: entity.id });
      setModal(null);
      if (selectedId === entity.id) setSelectedId(null);
      setToast({ type: "success", message: `${entity.name} foi removida` });
      await load();
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
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-text-primary">Cadastro Nacional de Entidades</h1>
            <p className="mt-1 text-sm text-text-secondary">
              Pessoas, veículos de imprensa, partidos, instituições, empresas e movimentos relevantes ao debate
              público monitorado.
            </p>
          </div>
          {/* Ação primária sempre visível, independente do estado de
              carregamento (Regras transversais de UX #2). */}
          <button
            type="button"
            onClick={() => {
              setConflictAccount(null);
              setModal({ type: "create" });
            }}
            className="rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Nova Entidade
          </button>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Buscar por nome..."
            className="w-full max-w-xs rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue"
          />
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as EntityType | "")}
            className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue"
          >
            <option value="">Todos os tipos</option>
            {ENTITY_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={partidoFilter}
            onChange={(event) => setPartidoFilter(event.target.value)}
            className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue"
          >
            <option value="">Todos os partidos</option>
            {knownPartidoFilters.map((partido) => (
              <option key={partido} value={partido}>
                {partido}
              </option>
            ))}
          </select>
          <select
            value={ideologiaFilter}
            onChange={(event) => setIdeologiaFilter(event.target.value)}
            className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue"
          >
            <option value="">Todas as ideologias</option>
            {IDEOLOGIA_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {IDEOLOGIA_LABEL[value]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
              className="h-4 w-4 rounded border-border-default text-accent-blue focus:ring-accent-blue"
            />
            Mostrar inativas
          </label>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={onlyWithoutAccounts}
              onChange={(event) => setOnlyWithoutAccounts(event.target.checked)}
              className="h-4 w-4 rounded border-border-default text-accent-blue focus:ring-accent-blue"
            />
            Sem conta associada
          </label>
        </div>

        <div className={`mt-4 grid grid-cols-1 gap-6 ${selectedEntity ? "lg:grid-cols-[minmax(0,1fr)_400px]" : ""}`}>
          <div className="overflow-x-auto rounded-xl border border-border-default bg-bg-card">
            {loadState === "loading" && (
              <table className="w-full min-w-[880px] text-left text-sm">
                <tbody>
                  {Array.from({ length: SKELETON_ROWS }).map((_, rowIndex) => (
                    <tr key={rowIndex} className="border-b border-border-subtle-2 last:border-0">
                      {Array.from({ length: SKELETON_COLUMNS }).map((__, colIndex) => (
                        <td key={colIndex} className="px-4 py-3">
                          <Skeleton className="h-4 w-full max-w-[120px]" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {loadState === "error" && (
              <div className="p-6">
                <ErrorMessage message="Não foi possível carregar as Entidades." onRetry={load} />
              </div>
            )}

            {loadState === "loaded" && entities.length === 0 && (
              <EmptyState message="Nenhuma Entidade cadastrada ainda." />
            )}

            {loadState === "loaded" && entities.length > 0 && filtered.length === 0 && (
              <EmptyState message="Nenhuma Entidade encontrada para os filtros selecionados." />
            )}

            {loadState === "loaded" && filtered.length > 0 && (
              <>
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-text-primary">
                      <SortableTh label="Nome" sortKey="name" sort={sort} onSort={toggleSort} />
                      <SortableTh label="Tipo" sortKey="type" sort={sort} onSort={toggleSort} />
                      <SortableTh label="Cargo" sortKey="cargo" sort={sort} onSort={toggleSort} />
                      <SortableTh label="Partido" sortKey="partido" sort={sort} onSort={toggleSort} />
                      <SortableTh label="Ideologia" sortKey="ideologia" sort={sort} onSort={toggleSort} />
                      <SortableTh label="Influência" sortKey="influence_level" sort={sort} onSort={toggleSort} />
                      <SortableTh label="Contas" sortKey="accounts" sort={sort} onSort={toggleSort} />
                      <SortableTh label="Status" sortKey="is_active" sort={sort} onSort={toggleSort} />
                      <th className="px-4 py-3 font-bold">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedEntities.map((entity) => {
                      const isPending = pendingIds.has(entity.id);
                      return (
                        <tr
                          key={entity.id}
                          onClick={() => handleRowClick(entity)}
                          className={`cursor-pointer border-b border-border-subtle-2 last:border-0 hover:bg-bg-page ${
                            selectedId === entity.id ? "bg-accent-blue-bg" : ""
                          }`}
                        >
                          <td className="px-4 py-3 text-text-primary">{entity.name}</td>
                          <td className="px-4 py-3">
                            <EntityTypeBadge type={entity.type} />
                          </td>
                          <td className="px-4 py-3 text-text-secondary">{entity.cargo ?? "—"}</td>
                          <td className="px-4 py-3 text-text-secondary">{entity.partido ?? "—"}</td>
                          <td className="px-4 py-3">
                            <IdeologiaBadge value={entity.ideologia} />
                          </td>
                          <td className="px-4 py-3">
                            <InfluenceBadge value={entity.influence_level} />
                          </td>
                          <td className="px-4 py-3 text-text-secondary">
                            {entity.accounts.length > 0 ? `${entity.accounts.length} conta(s)` : "Nenhuma"}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                entity.is_active ? "bg-[#eafaf1] text-[#1a9d5c]" : "bg-bg-page text-text-tertiary"
                              }`}
                            >
                              {entity.is_active ? "Ativa" : "Inativa"}
                            </span>
                          </td>
                          {/* Botões visíveis, não um menu "⋮" (pedido do
                              usuário) — Editar/Desativar-Reativar/Excluir
                              sempre à mostra, mesmo padrão de
                              finops-admin-view.tsx. stopPropagation — clicar
                              em qualquer ação não deve também selecionar/
                              desselecionar a linha (seleção de linha é só
                              pra visualizar). */}
                          <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                            <div className="flex flex-wrap items-center gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setConflictAccount(null);
                                  setModal({ type: "edit", entity });
                                }}
                                disabled={isPending}
                                className="text-sm font-medium text-accent-blue hover:underline disabled:opacity-50"
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  entity.is_active
                                    ? setModal({ type: "deactivate", entity })
                                    : handleToggleActive(entity)
                                }
                                disabled={isPending}
                                className="text-sm font-medium text-text-secondary hover:text-text-primary hover:underline disabled:opacity-50"
                              >
                                {entity.is_active ? "Desativar" : "Reativar"}
                              </button>
                              {/* Toda exclusão do sistema passa por
                                  confirmação — este botão só abre o
                                  ConfirmDialog abaixo, nunca chama
                                  delete-entity direto. */}
                              <button
                                type="button"
                                onClick={() => setModal({ type: "delete", entity })}
                                disabled={isPending}
                                className="text-sm font-medium text-[#e0483e] hover:underline disabled:opacity-50"
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
                <Pagination
                  page={page}
                  pageCount={pageCount}
                  onPageChange={setPage}
                  pageSize={pageSize}
                  onPageSizeChange={setPageSize}
                />
              </>
            )}
          </div>

          {selectedEntity && (
            <EntityDetailPanel
              entity={selectedEntity}
              onClose={() => setSelectedId(null)}
              onEdit={() => {
                setConflictAccount(null);
                setModal({ type: "edit", entity: selectedEntity });
              }}
            />
          )}
        </div>
      </div>

      {modal?.type === "create" && (
        <EntityFormModal
          knownParties={knownParties}
          knownTagValuesByType={knownTagValuesByType}
          conflictAccount={conflictAccount}
          onClose={() => setModal(null)}
          onSubmit={handleCreate}
        />
      )}

      {modal?.type === "edit" && (
        <EntityFormModal
          initial={modal.entity}
          knownParties={knownParties}
          knownTagValuesByType={knownTagValuesByType}
          conflictAccount={conflictAccount}
          onClose={() => setModal(null)}
          onSubmit={(values) => handleUpdate(modal.entity, values)}
        />
      )}

      {modal?.type === "deactivate" && (
        <ConfirmDialog
          title="Desativar Entidade"
          message={`Desativar ${modal.entity.name}? Ela deixa de aparecer nas listagens padrão, mas o cadastro não é perdido.`}
          confirmLabel="Desativar"
          loading={pendingIds.has(modal.entity.id)}
          onConfirm={() => handleToggleActive(modal.entity, { onSuccess: () => setModal(null) })}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.type === "delete" && (
        <ConfirmDialog
          title="Excluir Entidade"
          message={`Tem certeza que deseja excluir ${modal.entity.name}? Esta Entidade tem ${modal.entity.accounts.length} conta(s) e ${modal.entity.tags.length} classificação(ões) cadastradas — todas serão removidas junto. Esta ação não pode ser desfeita.`}
          confirmLabel="Excluir"
          loading={deleteLoading}
          onConfirm={() => handleDelete(modal.entity)}
          onCancel={() => setModal(null)}
        />
      )}

      {toast && <Toast type={toast.type} message={toast.message} />}
    </div>
  );
}
