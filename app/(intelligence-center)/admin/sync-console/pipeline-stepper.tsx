"use client";

import { Tooltip } from "@/components/ui/tooltip";
import { SYNC_STEPS, SYNC_STEP_DESCRIPTIONS, SYNC_STEP_LABELS, type SyncStep } from "./types";

// Chips de 1 fase do pipeline cada (.dev/specs/sync-console/pipeline-monitoring.md)
// — pedido do usuário: mostrar visualmente quais fases já rodaram no ciclo
// atual (verde) e quais ainda faltam (cinza), destacando qual é a próxima.
// Nenhum dado novo do backend foi necessário: `sync_cursors.next_step`
// (já buscado por get-sync-console-status como `currentStep`) já é
// exatamente "a próxima fase a rodar" — toda fase com índice MENOR na
// ordem fixa de SYNC_STEPS já rodou neste ciclo, toda fase com índice
// MAIOR ainda não rodou. Clicar num chip chama `onSelectStep` — a tela
// que usa este componente decide o que fazer (ver histórico daquela fase,
// ou executá-la sob demanda).
//
// ✅ Redesenhado (2026-07-16, pedido do usuário: "o frame que mostra o
// pipeline ainda está com scroll horizontal, retire e ajuste essa
// visualização"). O desenho original era uma única linha
// (`overflow-x-auto` + `min-w-[560px]`, 16 pontos de 16px ligados por
// traços) — em telas mais estreitas que 560px ela sempre precisava de
// scroll horizontal (a barra de rolagem nativa do Windows some com botões
// de seta nas pontas, o que apareceu no relato do usuário), e mesmo sem
// scroll a fase só era identificável passando o mouse (tooltip). Trocado
// por uma grade de chips com `flex-wrap` — nunca precisa de scroll (quebra
// de linha em vez de estourar a largura, por construção, em qualquer
// tamanho de tela) e cada chip já mostra o nome da fase diretamente, sem
// precisar de hover pra saber qual é qual.
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
      <div className="flex flex-wrap gap-2">
        {SYNC_STEPS.map((step, index) => {
          const isDone = currentIndex >= 0 && index < currentIndex;
          const isNext = index === currentIndex;
          return (
            <Tooltip key={step} text={SYNC_STEP_DESCRIPTIONS[step]} position="bottom">
              <button
                type="button"
                onClick={() => onSelectStep(step)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  isNext
                    ? "border-accent-blue bg-accent-blue-bg text-accent-blue"
                    : isDone
                    ? "border-[#c8ecd9] bg-[#eafaf1] text-[#1a9d5c]"
                    : "border-border-default bg-bg-card text-text-tertiary hover:border-text-tertiary"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    isNext ? "bg-accent-blue" : isDone ? "bg-[#1a9d5c]" : "bg-border-default"
                  }`}
                />
                {SYNC_STEP_LABELS[step]}
              </button>
            </Tooltip>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-text-secondary">
        {currentIndex >= 0 ? (
          <>
            Próxima fase: <span className="font-bold text-accent-blue">{SYNC_STEP_LABELS[currentStep as SyncStep]}</span>
          </>
        ) : (
          "Fase atual desconhecida."
        )}{" "}
        <span className="text-text-tertiary">— clique em um chip para ver o histórico daquela fase.</span>
      </p>
    </div>
  );
}
