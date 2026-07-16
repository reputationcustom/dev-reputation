"use client";

import { Tooltip } from "@/components/ui/tooltip";
import { SYNC_STEPS, SYNC_STEP_DESCRIPTIONS, SYNC_STEP_LABELS, type SyncStep } from "./types";

// Linha horizontal com 1 ponto por fase do pipeline (.dev/specs/sync-console/pipeline-monitoring.md)
// — pedido do usuário: mostrar visualmente quais fases já rodaram no ciclo
// atual (verde) e quais ainda faltam (cinza), destacando qual é a próxima.
// Nenhum dado novo do backend foi necessário: `sync_cursors.next_step`
// (já buscado por get-sync-console-status como `currentStep`) já é
// exatamente "a próxima fase a rodar" — toda fase com índice MENOR na
// ordem fixa de SYNC_STEPS já rodou neste ciclo, toda fase com índice
// MAIOR ainda não rodou. Clicar num ponto chama `onSelectStep` — a tela
// que usa este componente decide o que fazer (ver histórico daquela fase,
// ou executá-la sob demanda).
export function PipelineStepper({
  currentStep,
  onSelectStep,
}: {
  currentStep: string;
  onSelectStep: (step: SyncStep) => void;
}) {
  const currentIndex = SYNC_STEPS.indexOf(currentStep as SyncStep);

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-[560px] items-center">
          {SYNC_STEPS.map((step, index) => {
            const isDone = currentIndex >= 0 && index < currentIndex;
            const isNext = index === currentIndex;
            return (
              <div key={step} className="flex flex-1 items-center last:flex-none">
                <Tooltip text={`${SYNC_STEP_LABELS[step]} — ${SYNC_STEP_DESCRIPTIONS[step]}`}>
                  <button
                    type="button"
                    onClick={() => onSelectStep(step)}
                    aria-label={SYNC_STEP_LABELS[step]}
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-transform hover:scale-125 ${
                      isNext
                        ? "border-accent-blue bg-accent-blue ring-2 ring-accent-blue-bg"
                        : isDone
                        ? "border-[#1a9d5c] bg-[#1a9d5c]"
                        : "border-border-default bg-bg-card"
                    }`}
                  />
                </Tooltip>
                {index < SYNC_STEPS.length - 1 && (
                  <div className={`h-0.5 flex-1 ${isDone ? "bg-[#1a9d5c]" : "bg-border-default"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-xs text-text-secondary">
        {currentIndex >= 0 ? (
          <>
            Próxima fase: <span className="font-bold text-accent-blue">{SYNC_STEP_LABELS[currentStep as SyncStep]}</span>
          </>
        ) : (
          "Fase atual desconhecida."
        )}{" "}
        <span className="text-text-tertiary">— clique em um ponto para ver o histórico daquela fase.</span>
      </p>
    </div>
  );
}
