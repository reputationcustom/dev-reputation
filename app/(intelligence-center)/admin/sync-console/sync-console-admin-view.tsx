"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { callFunction } from "@/lib/supabase/call-function";
import { useUserProfile } from "@/hooks/use-user-profile";
import { formatDateTime } from "@/lib/date/format";
import { EmptyState } from "@/components/ui/empty-state";
import { Toast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { Pagination, DEFAULT_PAGE_SIZE } from "@/components/ui/pagination";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { TriggerStepModal } from "./trigger-step-modal";
import {
  SYNC_STEPS,
  SYNC_STEP_DESCRIPTIONS,
  SYNC_STEP_LABELS,
  STOP_REASON_LABELS,
  type SyncConsoleHistoryResponse,
  type SyncConsolePair,
  type SyncConsoleStatus,
  type SyncStep,
  type TriggerSyncStepResult,
} from "./types";

type LoadState = "loading" | "loaded" | "error";

// Heartbeat real do pg_cron é 1 minuto (foundation/sync-brandwatch.md) —
// 30s de polling aqui é suficiente pra tela nunca ficar mais de meio ciclo
// "atrasada" em relação ao estado real, sem virar uma enxurrada de chamadas.
const STATUS_POLL_MS = 30_000;

function pairLabel(pair: { projectName: string | null; queryName: string | null; projectId: number; queryId: number }): string {
  return `${pair.projectName ?? `Projeto ${pair.projectId}`} / ${pair.queryName ?? `Query ${pair.queryId}`}`;
}

// Painel de sync-console (.dev/specs/sync-console/overview.md) — pedido do
// usuário: "acompanhar a fase da integração, quando rolou, quando será a
// próxima execução, em que passo que está" + "executar partes específicas
// da integração" + "verificar todas as execuções que ocorreram e quantos
// registros foram sincronizados em cada etapa". Admin-only, escopo é a
// plataforma inteira (mesmo modelo de FinopsAdminView/UsersAdminView).
export function SyncConsoleAdminView() {
  const { timezone } = useUserProfile();

  const [status, setStatus] = useState<SyncConsoleStatus | null>(null);
  const [statusLoadState, setStatusLoadState] = useState<LoadState>("loading");

  const [history, setHistory] = useState<SyncConsoleHistoryResponse | null>(null);
  const [historyLoadState, setHistoryLoadState] = useState<LoadState>("loading");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyFilter, setHistoryFilter] = useState<{ projectId: number; queryId: number } | null>(null);

  const [triggerModalPair, setTriggerModalPair] = useState<SyncConsolePair | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);

  const loadStatus = useCallback(async (isBackgroundRefresh = false) => {
    if (!isBackgroundRefresh) setStatusLoadState("loading");
    try {
      const data = await callFunction<SyncConsoleStatus>("get-sync-console-status");
      setStatus(data);
      setStatusLoadState("loaded");
    } catch {
      if (!isBackgroundRefresh) setStatusLoadState("error");
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoadState("loading");
    try {
      const data = await callFunction<SyncConsoleHistoryResponse>("get-sync-console-history", {
        page: historyPage,
        pageSize: DEFAULT_PAGE_SIZE,
        ...(historyFilter ? { projectId: historyFilter.projectId, queryId: historyFilter.queryId } : {}),
      });
      setHistory(data);
      setHistoryLoadState("loaded");
    } catch {
      setHistoryLoadState("error");
    }
  }, [historyPage, historyFilter]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Tabela de pares se auto-atualiza (regra do pipeline-monitoring.md) — o
  // widget de histórico NÃO faz polling (resetaria a página/filtro
  // enquanto o admin está navegando), só refaz a busca quando filtro/página
  // mudam ou uma execução manual acaba de rodar.
  useEffect(() => {
    const interval = setInterval(() => loadStatus(true), STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [loadStatus]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  function handleViewHistory(pair: SyncConsolePair) {
    setHistoryFilter({ projectId: pair.projectId, queryId: pair.queryId });
    setHistoryPage(1);
    historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleTriggerStep(step: SyncStep): Promise<TriggerSyncStepResult> {
    if (!triggerModalPair) throw new Error("Par não selecionado.");
    const result = await callFunction<TriggerSyncStepResult>("trigger-sync-step", {
      projectId: triggerModalPair.projectId,
      queryId: triggerModalPair.queryId,
      step,
    });
    if (result.ok) {
      setToast({ type: "success", message: "Fase executada com sucesso." });
      await loadStatus();
      if (
        historyFilter?.projectId === triggerModalPair.projectId &&
        historyFilter?.queryId === triggerModalPair.queryId
      ) {
        await loadHistory();
      }
    } else {
      setToast({ type: "error", message: result.error ?? "Não foi possível executar a fase." });
    }
    return result;
  }

  return (
    <div className="py-6">
      <div className="mx-auto max-w-6xl">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Sincronização — Pipeline Brandwatch</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Acompanhe a fase atual de cada par, o histórico completo de execuções e force fases específicas do
            pipeline sob demanda.
          </p>
        </div>

        {/* Card explicativo sempre visível — pedido do usuário: "breve
            explicação de como funciona a integração", pra facilitar quem
            for sustentar isso no dia a dia. */}
        <div className="mt-6 rounded-xl border border-accent-blue-bg bg-accent-blue-bg p-5">
          <h2 className="text-sm font-bold text-text-primary">Como funciona a integração</h2>
          <p className="mt-2 text-sm leading-relaxed text-text-primary">
            A cada minuto, o sistema verifica se algum Projeto/Query da Brandwatch está pronto para uma nova rodada
            de sincronização (o intervalo configurado hoje é de{" "}
            <strong>{status ? `${status.syncIntervalHours} hora(s)` : "—"}</strong>). Cada rodada completa passa por
            16 etapas, uma de cada vez (volume de menções, métricas diárias, tópicos, autores, etc.) — isso existe
            para nunca estourar o limite de chamadas que a Brandwatch permite (30 a cada 10 minutos). Se uma etapa
            específica parecer com dado desatualizado ou incorreto, use o botão &quot;Executar fase específica&quot;
            na linha correspondente para forçar só aquela etapa a rodar de novo, sem esperar o ciclo inteiro.
          </p>

          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-accent-blue">
              Ver as 16 etapas do pipeline
            </summary>
            <ul className="mt-2 flex flex-col gap-1.5">
              {SYNC_STEPS.map((step) => (
                <li key={step} className="text-xs text-text-secondary">
                  <span className="font-medium text-text-primary">{SYNC_STEP_LABELS[step]}</span> —{" "}
                  {SYNC_STEP_DESCRIPTIONS[step]}
                </li>
              ))}
            </ul>
          </details>
        </div>

        {/* Estado global */}
        {status && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
            <GlobalStateTile
              label="Concorrência"
              tooltip="Uma sincronização (automática ou manual) está em andamento neste exato momento, para evitar que duas rodadas rodem ao mesmo tempo e disputem o limite de chamadas da Brandwatch."
              value={status.globalState.locked ? "Travado" : "Livre"}
              tone={status.globalState.locked ? "warn" : "ok"}
            />
            <GlobalStateTile
              label="Limite de chamadas"
              tooltip="O sistema recebeu um aviso da Brandwatch de que o limite de chamadas está perto do teto e está pausando novas chamadas por um tempo, para evitar erro. Isso se resolve sozinho."
              value={status.globalState.rateLimited ? "Aguardando" : "Livre"}
              tone={status.globalState.rateLimited ? "warn" : "ok"}
            />
            <GlobalStateTile
              label="Uso do limite de chamadas"
              tooltip="De um total de 30 chamadas permitidas a cada 10 minutos (regra da própria Brandwatch, compartilhada entre todos os pares), quantas já foram usadas na última verificação."
              value={status.globalState.lastRateLimitUsed !== null ? `${status.globalState.lastRateLimitUsed} de 30` : "—"}
            />
            <GlobalStateTile
              label="Intervalo configurado"
              tooltip="De quanto em quanto tempo cada par (Projeto, Query) é considerado 'devido' para uma nova rodada completa de sincronização — configurável via secret BW_SYNC_INTERVAL_HOURS, não por esta tela."
              value={`${status.syncIntervalHours}h`}
            />
          </div>
        )}

        {/* Tabela de pares */}
        <div className="mt-6">
          <WidgetCard title="Pares (Projeto, Query)" status={statusLoadState} onRetry={() => loadStatus()}>
            {status && status.pairs.length === 0 && (
              <EmptyState message="Nenhum par sincronizado ainda — o bootstrap inicial ainda não rodou." />
            )}
            {status && status.pairs.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-text-primary">
                      <th className="px-2 py-2 font-bold">Par</th>
                      <th className="px-2 py-2 font-bold">
                        <Tooltip
                          position="bottom"
                          text="A próxima etapa que este par vai executar quando for a vez dele. O pipeline tem 16 etapas fixas, sempre na mesma ordem."
                        >
                          <span className="inline-flex items-center gap-1">
                            Fase atual
                            <QuestionMark />
                          </span>
                        </Tooltip>
                      </th>
                      <th className="px-2 py-2 font-bold">
                        <Tooltip
                          position="bottom"
                          text="A última vez que este par terminou as 16 etapas do início ao fim. Enquanto isso não acontece de novo, o par continua acumulando progresso etapa por etapa."
                        >
                          <span className="inline-flex items-center gap-1">
                            Última sincronização
                            <QuestionMark />
                          </span>
                        </Tooltip>
                      </th>
                      <th className="px-2 py-2 font-bold">
                        <Tooltip
                          position="bottom"
                          text="Calculada como: última sincronização completa + intervalo configurado. Se já passou desse horário, o par está 'devido' — a próxima verificação do sistema (a cada 1 minuto) já deve pegá-lo."
                        >
                          <span className="inline-flex items-center gap-1">
                            Próxima execução
                            <QuestionMark />
                          </span>
                        </Tooltip>
                      </th>
                      <th className="px-2 py-2 font-bold">Status</th>
                      <th className="px-2 py-2 font-bold">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.pairs.map((pair) => (
                      <tr
                        key={`${pair.projectId}-${pair.queryId}`}
                        className={`border-b border-border-subtle-2 last:border-0 ${
                          pair.status === "error" ? "bg-[#fdecea]" : ""
                        }`}
                      >
                        <td className="px-2 py-2 text-text-primary">{pairLabel(pair)}</td>
                        <td className="px-2 py-2 text-text-secondary">
                          {SYNC_STEP_LABELS[pair.currentStep as SyncStep] ?? pair.currentStep}
                        </td>
                        <td className="px-2 py-2 text-text-secondary">
                          {pair.lastSyncedAt ? formatDateTime(pair.lastSyncedAt, timezone) : "Ainda não sincronizado"}
                        </td>
                        <td className="px-2 py-2 text-text-secondary">
                          {pair.dueNow
                            ? "Devido agora — aguardando o próximo minuto"
                            : pair.nextDueAt
                            ? formatDateTime(pair.nextDueAt, timezone)
                            : "—"}
                        </td>
                        <td className="px-2 py-2">
                          {pair.status === "error" ? (
                            <Tooltip position="bottom" text={pair.lastError ?? "Erro desconhecido."}>
                              <span className="text-sm font-medium text-[#a52820]">Erro</span>
                            </Tooltip>
                          ) : (
                            <span className="text-sm text-text-secondary">Normal</span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => handleViewHistory(pair)}
                              className="text-sm font-medium text-accent-blue hover:underline"
                            >
                              Ver histórico completo
                            </button>
                            <button
                              type="button"
                              onClick={() => setTriggerModalPair(pair)}
                              className="text-sm font-medium text-accent-blue hover:underline"
                            >
                              Executar fase específica
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </WidgetCard>
        </div>

        {/* Histórico de execuções — "verificar todas as execuções que
            ocorreram" (pedido do usuário), sempre visível nesta mesma
            página, paginado, nunca capado a uma janela fixa. */}
        <div ref={historyRef} className="mt-6">
          <WidgetCard
            title="Histórico de execuções"
            status={historyLoadState}
            onRetry={loadHistory}
            headerAction={
              <div className="flex items-center gap-2">
                <label htmlFor="history-pair-filter" className="text-xs text-text-secondary">
                  Par
                </label>
                <select
                  id="history-pair-filter"
                  value={historyFilter ? `${historyFilter.projectId}-${historyFilter.queryId}` : "all"}
                  onChange={(event) => {
                    setHistoryPage(1);
                    if (event.target.value === "all") {
                      setHistoryFilter(null);
                      return;
                    }
                    const [projectId, queryId] = event.target.value.split("-").map(Number);
                    setHistoryFilter({ projectId, queryId });
                  }}
                  className="rounded-md border border-border-default px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-blue"
                >
                  <option value="all">Todos os pares</option>
                  {(status?.pairs ?? []).map((pair) => (
                    <option key={`${pair.projectId}-${pair.queryId}`} value={`${pair.projectId}-${pair.queryId}`}>
                      {pairLabel(pair)}
                    </option>
                  ))}
                </select>
              </div>
            }
          >
            {history && history.items.length === 0 && (
              <EmptyState message="Nenhuma execução encontrada para este filtro." />
            )}
            {history && history.items.length > 0 && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-text-primary">
                        {!historyFilter && <th className="px-2 py-2 font-bold">Par</th>}
                        <th className="px-2 py-2 font-bold">Fase</th>
                        <th className="px-2 py-2 font-bold">Quando</th>
                        <th className="px-2 py-2 font-bold">Duração</th>
                        <th className="px-2 py-2 font-bold">
                          <Tooltip
                            position="bottom"
                            text="Quantas linhas essa execução gravou ou atualizou no banco de dados. Um número baixo ou zero não é necessariamente um problema — pode ser que já estivesse tudo em dia."
                          >
                            <span className="inline-flex items-center gap-1">
                              Registros sincronizados
                              <QuestionMark />
                            </span>
                          </Tooltip>
                        </th>
                        <th className="px-2 py-2 font-bold">
                          <Tooltip
                            position="bottom"
                            text="'Automático' = rodou sozinho, no ciclo normal. 'Manual' = um admin forçou essa etapa específica a rodar."
                          >
                            <span className="inline-flex items-center gap-1">
                              Origem
                              <QuestionMark />
                            </span>
                          </Tooltip>
                        </th>
                        <th className="px-2 py-2 font-bold">Resultado</th>
                        <th className="px-2 py-2 font-bold">
                          <Tooltip
                            position="bottom"
                            text="Por que a sequência de etapas parou nesta invocação (só em linhas automáticas) — nenhum desses é um erro."
                          >
                            <span className="inline-flex items-center gap-1">
                              Motivo de parada
                              <QuestionMark />
                            </span>
                          </Tooltip>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.items.map((item) => (
                        <tr key={item.id} className="border-b border-border-subtle-2 last:border-0">
                          {!historyFilter && (
                            <td className="px-2 py-2 text-text-primary">
                              {item.projectName ?? `Projeto ${item.projectId}`} /{" "}
                              {item.queryName ?? `Query ${item.queryId}`}
                            </td>
                          )}
                          <td className="px-2 py-2 text-text-primary">
                            {item.step ? SYNC_STEP_LABELS[item.step as SyncStep] ?? item.step : "—"}
                          </td>
                          <td className="px-2 py-2 text-text-secondary">{formatDateTime(item.createdAt, timezone)}</td>
                          <td className="px-2 py-2 text-text-secondary">
                            {item.durationMs !== null ? `${(item.durationMs / 1000).toFixed(1)}s` : "—"}
                          </td>
                          <td className="px-2 py-2 text-text-secondary">{item.rowsProcessed}</td>
                          <td className="px-2 py-2 text-text-secondary">
                            {item.triggerSource === "manual"
                              ? `Manual${item.triggeredByUserName ? ` (${item.triggeredByUserName})` : ""}`
                              : "Automático"}
                          </td>
                          <td className="px-2 py-2">
                            {item.status === "error" ? (
                              <Tooltip position="bottom" text={item.errorMessage ?? "Erro desconhecido."}>
                                <span className="text-sm font-medium text-[#a52820]">Erro</span>
                              </Tooltip>
                            ) : (
                              <span className="text-sm text-[#1a9d5c]">Sucesso</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-text-secondary">
                            {item.stopReason ? STOP_REASON_LABELS[item.stopReason] ?? item.stopReason : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={history.page}
                  pageCount={Math.max(1, Math.ceil(history.totalCount / history.pageSize))}
                  onPageChange={setHistoryPage}
                />
              </>
            )}
          </WidgetCard>
        </div>
      </div>

      {triggerModalPair && (
        <TriggerStepModal
          projectId={triggerModalPair.projectId}
          queryId={triggerModalPair.queryId}
          pairLabel={pairLabel(triggerModalPair)}
          onClose={() => setTriggerModalPair(null)}
          onSubmit={handleTriggerStep}
        />
      )}

      {toast && <Toast type={toast.type} message={toast.message} />}
    </div>
  );
}

function QuestionMark() {
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-border-default text-[10px] font-bold text-text-tertiary">
      ?
    </span>
  );
}

function GlobalStateTile({
  label,
  value,
  tooltip,
  tone,
}: {
  label: string;
  value: string;
  tooltip: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="rounded-xl border border-border-default bg-bg-card p-5">
      <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-text-primary">
        {label}
        <Tooltip text={tooltip}>
          <QuestionMark />
        </Tooltip>
      </p>
      <p className={`mt-2 text-xl font-bold ${tone === "warn" ? "text-[#a52820]" : "text-text-primary"}`}>{value}</p>
    </div>
  );
}
