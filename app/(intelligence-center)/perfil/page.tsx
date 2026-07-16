"use client";

import { useEffect, useState } from "react";
import { useUserProfile } from "@/hooks/use-user-profile";
import { callFunction } from "@/lib/supabase/call-function";
import { DEFAULT_TIMEZONE } from "@/lib/date/format";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";
import { Toast } from "@/components/ui/toast";
import { BACKEND_ERROR_MESSAGE } from "@/lib/errors";

// Lista IANA completa via Intl.supportedValuesOf (suportado nos browsers-alvo
// e em Node >=20) — evita depender de um pacote externo só pra essa lista.
const TIMEZONES: string[] =
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : [DEFAULT_TIMEZONE];

export default function PerfilPage() {
  const { status, timezone, isAdmin, showAiRefreshButton, retry } = useUserProfile();
  const [selectedTimezone, setSelectedTimezone] = useState(timezone);
  const [saving, setSaving] = useState(false);
  const [savingRefreshButton, setSavingRefreshButton] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(
    null,
  );

  useEffect(() => {
    if (status === "loaded") setSelectedTimezone(timezone);
  }, [status, timezone]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function handleSave() {
    setSaving(true);
    try {
      await callFunction("update-my-timezone", { timezone: selectedTimezone });
      setToast({ type: "success", message: "Fuso horário atualizado." });
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : BACKEND_ERROR_MESSAGE,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleRefreshButton() {
    setSavingRefreshButton(true);
    try {
      await callFunction("update-my-refresh-button-preference", { show: !showAiRefreshButton });
      setToast({
        type: "success",
        message: !showAiRefreshButton
          ? "Botão 'Atualizar resumo executivo' visível fora do período personalizado."
          : "Botão 'Atualizar resumo executivo' oculto fora do período personalizado.",
      });
      retry();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : BACKEND_ERROR_MESSAGE,
      });
    } finally {
      setSavingRefreshButton(false);
    }
  }

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-lg">
        <h1 className="text-xl font-bold text-text-primary">Perfil</h1>
        <p className="mt-1 text-sm text-text-secondary">Preferências da sua conta.</p>

        <div className="mt-6 rounded-xl border border-border-default bg-bg-card p-6">
          {status === "loading" && (
            <div className="flex justify-center py-10">
              <Spinner className="h-6 w-6 text-accent-blue" />
            </div>
          )}

          {status === "error" && <ErrorMessage message={BACKEND_ERROR_MESSAGE} onRetry={retry} />}

          {status === "loaded" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="timezone" className="text-sm font-medium text-text-primary">
                  Fuso horário
                </label>
                <select
                  id="timezone"
                  value={selectedTimezone}
                  onChange={(event) => setSelectedTimezone(event.target.value)}
                  disabled={saving}
                  className="rounded-md border border-border-default px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue disabled:opacity-60"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-text-tertiary">
                  Usado para exibir datas e horários em todo o produto.
                </p>
              </div>

              <button
                type="button"
                onClick={handleSave}
                disabled={saving || selectedTimezone === timezone}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                {saving && <Spinner className="h-4 w-4 text-white" />}
                Salvar
              </button>

              {isAdmin && (
                <div className="flex flex-col gap-1 border-t border-border-default pt-4">
                  <label className="flex items-start gap-2 text-sm font-medium text-text-primary">
                    <input
                      type="checkbox"
                      checked={showAiRefreshButton}
                      disabled={savingRefreshButton}
                      onChange={handleToggleRefreshButton}
                      className="mt-0.5 h-4 w-4 rounded border-border-default disabled:opacity-60"
                    />
                    Mostrar botão &quot;Atualizar resumo executivo&quot; fora do período
                    personalizado
                    {savingRefreshButton && <Spinner className="h-4 w-4 text-accent-blue" />}
                  </label>
                  <p className="text-xs text-text-tertiary">
                    Fica desligado por padrão (não aparece em apresentações do produto). Ligue
                    para forçar a recomposição do resumo executivo em desenvolvimento/testes.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} />}
    </div>
  );
}
