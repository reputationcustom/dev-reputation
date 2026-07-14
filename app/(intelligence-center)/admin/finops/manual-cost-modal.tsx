"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { FINOPS_RECURRENCE_LABELS, type FinopsCostRecurrence, type FinopsManualCost } from "./types";

export interface ManualCostFormValues {
  description: string;
  amount_usd: number;
  recurrence: FinopsCostRecurrence;
  effective_date: string;
  end_date: string | null;
}

// Formulário de custo extra (avulso/mensal/anual) — cria e edita, mesmo
// componente (pedido implícito de "não duplicar UI", mesmo padrão já usado
// por OrganizationsMultiSelect entre o convite e a edição de organizações).
export function ManualCostModal({
  initial,
  onClose,
  onSubmit,
}: {
  initial?: FinopsManualCost;
  onClose: () => void;
  onSubmit: (values: ManualCostFormValues) => Promise<void>;
}) {
  const [description, setDescription] = useState(initial?.description ?? "");
  const [amountUsd, setAmountUsd] = useState(initial ? String(initial.amount_usd) : "");
  const [recurrence, setRecurrence] = useState<FinopsCostRecurrence>(initial?.recurrence ?? "monthly");
  const [effectiveDate, setEffectiveDate] = useState(initial?.effective_date ?? "");
  const [endDate, setEndDate] = useState(initial?.end_date ?? "");
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [effectiveDateError, setEffectiveDateError] = useState<string | null>(null);
  const [endDateError, setEndDateError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setDescriptionError(null);
    setAmountError(null);
    setEffectiveDateError(null);
    setEndDateError(null);
    setFormError(null);

    let hasError = false;
    if (!description.trim()) {
      setDescriptionError("Descrição obrigatória");
      hasError = true;
    }
    const amount = Number(amountUsd);
    if (!amountUsd || !Number.isFinite(amount) || amount < 0) {
      setAmountError("Informe um valor válido (USD)");
      hasError = true;
    }
    if (!effectiveDate) {
      setEffectiveDateError("Data obrigatória");
      hasError = true;
    }
    if (endDate && effectiveDate && endDate < effectiveDate) {
      setEndDateError("Não pode ser anterior à data efetiva");
      hasError = true;
    }
    if (hasError) return;

    setLoading(true);
    try {
      await onSubmit({
        description: description.trim(),
        amount_usd: amount,
        recurrence,
        effective_date: effectiveDate,
        end_date: endDate || null,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Algo deu errado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={initial ? "Editar custo extra" : "Cadastrar custo extra"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {formError && (
          <p className="rounded-md bg-[#fdecea] px-3 py-2 text-sm text-[#a52820]" role="alert">
            {formError}
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="cost-description" className="text-sm font-medium text-text-primary">
            Descrição
          </label>
          <input
            id="cost-description"
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={loading}
            placeholder="Ex: Licença de ferramenta de monitoramento"
            className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
          />
          {descriptionError && <p className="text-xs text-[#e0483e]">{descriptionError}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="cost-amount" className="text-sm font-medium text-text-primary">
            Valor (USD)
          </label>
          <input
            id="cost-amount"
            type="number"
            min="0"
            step="0.01"
            value={amountUsd}
            onChange={(event) => setAmountUsd(event.target.value)}
            disabled={loading}
            className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
          />
          {amountError && <p className="text-xs text-[#e0483e]">{amountError}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text-primary">Recorrência</span>
          <div className="flex gap-4">
            {(Object.keys(FINOPS_RECURRENCE_LABELS) as FinopsCostRecurrence[]).map((value) => (
              <label key={value} className="flex items-center gap-1.5 text-sm text-text-primary">
                <input
                  type="radio"
                  name="recurrence"
                  checked={recurrence === value}
                  onChange={() => setRecurrence(value)}
                  disabled={loading}
                  className="h-4 w-4 border-border-default text-accent-blue focus:ring-accent-blue"
                />
                {FINOPS_RECURRENCE_LABELS[value]}
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="cost-effective-date" className="text-sm font-medium text-text-primary">
              {recurrence === "one_time" ? "Data" : "Início da recorrência"}
            </label>
            <input
              id="cost-effective-date"
              type="date"
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
              disabled={loading}
              className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
            />
            {effectiveDateError && <p className="text-xs text-[#e0483e]">{effectiveDateError}</p>}
          </div>

          {recurrence !== "one_time" && (
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="cost-end-date" className="text-sm font-medium text-text-primary">
                Fim (opcional)
              </label>
              <input
                id="cost-end-date"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                disabled={loading}
                className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
              />
              {endDateError && <p className="text-xs text-[#e0483e]">{endDateError}</p>}
            </div>
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
            disabled={loading}
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
