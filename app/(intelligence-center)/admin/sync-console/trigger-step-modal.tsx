"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { SYNC_STEPS, SYNC_STEP_DESCRIPTIONS, SYNC_STEP_LABELS, type SyncStep, type TriggerSyncStepResult } from "./types";

// Modal "Executar fase específica" (.dev/specs/sync-console/manual-step-execution.md)
// — sempre 1 par + 1 fase por vez (decisão deliberada, nunca um botão de
// "re-rodar tudo"). Mostra o resultado inline antes de fechar, não só um
// toast que já sumiu. `defaultStep` (novo) — pré-seleciona a fase clicada
// no stepper horizontal (pipeline-stepper.tsx) quando o admin abre este
// modal a partir de um ponto específico, em vez de sempre abrir em
// "Menções"; continua totalmente editável via <select>, nunca trava numa
// única fase.
export function TriggerStepModal({
  projectId,
  queryId,
  pairLabel,
  defaultStep,
  onClose,
  onSubmit,
}: {
  projectId: number;
  queryId: number;
  pairLabel: string;
  defaultStep?: SyncStep;
  onClose: () => void;
  onSubmit: (step: SyncStep) => Promise<TriggerSyncStepResult>;
}) {
  const [step, setStep] = useState<SyncStep>(defaultStep ?? "mentions");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TriggerSyncStepResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setResult(null);
    setLoading(true);
    try {
      const outcome = await onSubmit(step);
      setResult(outcome);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Algo deu errado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Executar fase específica" onClose={onClose}>
      <p className="text-sm text-text-secondary">
        Par: <span className="font-medium text-text-primary">{pairLabel}</span>
      </p>
      <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-text-tertiary">
        Isso roda só a etapa escolhida, agora, fora da ordem normal
        <Tooltip text="Não altera em que etapa o ciclo automático deste par está, nem acelera as próximas etapas dele — fica registrado só como uma execução manual no histórico.">
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-border-default text-[10px] font-bold text-text-tertiary">
            ?
          </span>
        </Tooltip>
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        {formError && (
          <p className="rounded-md bg-[#fdecea] px-3 py-2 text-sm text-[#a52820]" role="alert">
            {formError}
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="sync-step-select" className="text-sm font-medium text-text-primary">
            Fase
          </label>
          <select
            id="sync-step-select"
            value={step}
            onChange={(event) => {
              setStep(event.target.value as SyncStep);
              setResult(null);
            }}
            disabled={loading}
            className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
          >
            {SYNC_STEPS.map((value) => (
              <option key={value} value={value}>
                {SYNC_STEP_LABELS[value]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-text-secondary">{SYNC_STEP_DESCRIPTIONS[step]}</p>
        </div>

        {result && (
          <div
            className={`rounded-md px-3 py-2 text-sm ${
              result.ok ? "bg-[#eafaf1] text-[#1a9d5c]" : "bg-[#fdecea] text-[#a52820]"
            }`}
          >
            {result.ok ? (
              <>
                Execução concluída — {result.recordsSynced ?? 0} registro(s) sincronizado(s)
                {typeof result.durationMs === "number" ? ` em ${(result.durationMs / 1000).toFixed(1)}s` : ""}.
              </>
            ) : (
              result.error ?? "Não foi possível executar a fase."
            )}
          </div>
        )}

        <div className="mt-2 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-md border border-border-default px-4 py-2 text-sm font-medium text-text-primary hover:bg-bg-page disabled:opacity-60"
          >
            Fechar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {loading && <Spinner className="h-4 w-4 text-white" />}
            Executar
          </button>
        </div>
      </form>
    </Modal>
  );
}
