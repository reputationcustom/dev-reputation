"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Trend } from "@reputation/shared-types";
import { callFunction } from "@/lib/supabase/call-function";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorMessage } from "@/components/ui/error-message";
import { EmptyState } from "@/components/ui/empty-state";
import { Toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { TrendLineChart } from "@/components/intelligence-center/charts/trend-line-chart";
import { ManualCostModal, type ManualCostFormValues } from "./manual-cost-modal";
import {
  FINOPS_RECURRENCE_LABELS,
  FINOPS_SOURCE_LABELS,
  type FinopsManualCost,
  type FinopsOverview,
} from "./types";

type LoadState = "loading" | "loaded" | "error";
type ModalState = { type: "create" } | { type: "edit"; cost: FinopsManualCost } | { type: "delete"; cost: FinopsManualCost } | null;

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function formatUsd(value: number): string {
  return USD_FORMATTER.format(value);
}

function formatDateBr(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

// Painel de FinOps (.dev/specs/finops/overview.md) — pedido do usuário:
// "finops centralizado e fácil", com previsão de gasto e custos extras
// cadastráveis. Admin-only, escopo é a plataforma inteira (não uma
// organização) — mesmo fetch único de UsersAdminView (sem hook dedicado,
// mesma convenção já usada nas telas de /admin).
export function FinopsAdminView() {
  const [overview, setOverview] = useState<FinopsOverview | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modal, setModal] = useState<ModalState>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const data = await callFunction<FinopsOverview>("get-finops-overview");
      setOverview(data);
      setLoadState("loaded");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const trend: Trend | undefined = useMemo(() => {
    if (!overview) return undefined;
    return {
      key: "finops_daily_cost",
      label: "Gasto diário de IA (USD)",
      series: overview.daily_trend.map((point) => ({ date: point.date, value: point.cost_usd })),
    };
  }, [overview]);

  async function handleCreate(values: ManualCostFormValues) {
    await callFunction("create-finops-manual-cost", values);
    setModal(null);
    setToast({ type: "success", message: "Custo extra cadastrado" });
    await load();
  }

  async function handleUpdate(cost: FinopsManualCost, values: ManualCostFormValues) {
    await callFunction("update-finops-manual-cost", { id: cost.id, ...values });
    setModal(null);
    setToast({ type: "success", message: "Custo extra atualizado" });
    await load();
  }

  async function handleDelete(cost: FinopsManualCost) {
    setDeleteLoading(true);
    try {
      await callFunction("delete-finops-manual-cost", { id: cost.id });
      setModal(null);
      setToast({ type: "success", message: "Custo extra removido" });
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
            <h1 className="text-xl font-bold text-text-primary">FinOps — Custos de IA</h1>
            <p className="mt-1 text-sm text-text-secondary">
              Consumo real de IA da plataforma (nunca estimativa) e custos extras cadastrados.
            </p>
          </div>
          {/* Sempre visível independente do estado de carregamento (Regras de UX #2). */}
          <button
            type="button"
            onClick={() => setModal({ type: "create" })}
            className="rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            + Cadastrar custo extra
          </button>
        </div>

        {loadState === "loading" && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border-default bg-bg-card p-5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-3 h-7 w-32" />
              </div>
            ))}
          </div>
        )}

        {loadState === "error" && (
          <div className="mt-6">
            <ErrorMessage message="Não foi possível carregar o painel de custos." onRetry={load} />
          </div>
        )}

        {loadState === "loaded" && overview && (
          <>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
              <KpiTile
                label="Gasto hoje (IA)"
                value={formatUsd(overview.today.cost_usd)}
                sublabel={`${overview.today.call_count} chamada(s)`}
              />
              <KpiTile
                label="Gasto no mês (IA)"
                value={formatUsd(overview.month_to_date.cost_usd)}
                sublabel={`dia ${overview.projection.days_elapsed} de ${overview.projection.days_in_month}`}
              />
              <KpiTile
                label="Custos extras no mês"
                value={formatUsd(overview.projection.manual_costs_this_month_usd)}
                sublabel="mensais/anuais/pontuais ativos"
              />
              <KpiTile
                label="Projeção total do mês"
                value={formatUsd(overview.projection.projected_total_month_usd)}
                sublabel={`IA projetada: ${formatUsd(overview.projection.projected_ai_cost_usd)}`}
                highlight
              />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <WidgetCard title="Gasto diário de IA — últimos 30 dias" status="loaded" onRetry={load}>
                  <TrendLineChart trend={trend} emptyMessage="Sem uso de IA registrado ainda." />
                </WidgetCard>
              </div>

              <WidgetCard title="Uso de IA por origem — mês corrente" status="loaded" onRetry={load}>
                {overview.month_to_date.by_source.length === 0 ? (
                  <EmptyState message="Sem uso de IA registrado neste mês." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-text-primary">
                          <th className="py-2 pr-2 font-bold">Origem</th>
                          <th className="py-2 pr-2 font-bold">Chamadas</th>
                          <th className="py-2 font-bold">Custo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.month_to_date.by_source.map((row) => (
                          <tr key={row.source} className="border-b border-border-subtle-2 last:border-0">
                            <td className="py-2 pr-2 text-text-primary">{FINOPS_SOURCE_LABELS[row.source]}</td>
                            <td className="py-2 pr-2 text-text-secondary">{row.call_count}</td>
                            <td className="py-2 font-medium text-text-primary">{formatUsd(row.cost_usd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </WidgetCard>
            </div>

            <div className="mt-6 rounded-xl border border-border-default bg-bg-card p-5">
              <h2 className="text-sm font-bold text-text-primary">Custos extras cadastrados</h2>
              {overview.manual_costs.length === 0 ? (
                <div className="mt-4">
                  <EmptyState message="Nenhum custo extra cadastrado ainda." />
                </div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-text-primary">
                        <th className="px-2 py-2 font-bold">Descrição</th>
                        <th className="px-2 py-2 font-bold">Valor</th>
                        <th className="px-2 py-2 font-bold">Recorrência</th>
                        <th className="px-2 py-2 font-bold">Data</th>
                        <th className="px-2 py-2 font-bold">Término</th>
                        <th className="px-2 py-2 font-bold">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.manual_costs.map((cost) => (
                        <tr key={cost.id} className="border-b border-border-subtle-2 last:border-0">
                          <td className="px-2 py-2 text-text-primary">{cost.description}</td>
                          <td className="px-2 py-2 text-text-secondary">{formatUsd(cost.amount_usd)}</td>
                          <td className="px-2 py-2 text-text-secondary">{FINOPS_RECURRENCE_LABELS[cost.recurrence]}</td>
                          <td className="px-2 py-2 text-text-secondary">{formatDateBr(cost.effective_date)}</td>
                          <td className="px-2 py-2 text-text-secondary">
                            {cost.end_date ? formatDateBr(cost.end_date) : "—"}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex gap-3">
                              <button
                                type="button"
                                onClick={() => setModal({ type: "edit", cost })}
                                className="text-sm font-medium text-accent-blue hover:underline"
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => setModal({ type: "delete", cost })}
                                className="text-sm font-medium text-[#e0483e] hover:underline"
                              >
                                Excluir
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {modal?.type === "create" && <ManualCostModal onClose={() => setModal(null)} onSubmit={handleCreate} />}

      {modal?.type === "edit" && (
        <ManualCostModal
          initial={modal.cost}
          onClose={() => setModal(null)}
          onSubmit={(values) => handleUpdate(modal.cost, values)}
        />
      )}

      {modal?.type === "delete" && (
        <ConfirmDialog
          title="Excluir custo extra"
          message={`Tem certeza que deseja excluir "${modal.cost.description}"? Esta ação não pode ser desfeita.`}
          confirmLabel="Excluir"
          loading={deleteLoading}
          onConfirm={() => handleDelete(modal.cost)}
          onCancel={() => setModal(null)}
        />
      )}

      {toast && <Toast type={toast.type} message={toast.message} />}
    </div>
  );
}

function KpiTile({
  label,
  value,
  sublabel,
  highlight,
}: {
  label: string;
  value: string;
  sublabel: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-5 ${
        highlight ? "border-accent-blue bg-accent-blue-bg" : "border-border-default bg-bg-card"
      }`}
    >
      <p className="text-xs font-bold uppercase tracking-wide text-text-primary">{label}</p>
      <p className="mt-2 text-2xl font-bold text-text-primary">{value}</p>
      <p className="mt-1 text-xs text-text-secondary">{sublabel}</p>
    </div>
  );
}
