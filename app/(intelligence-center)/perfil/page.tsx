"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { useUserProfile } from "@/hooks/use-user-profile";
import { createClient } from "@/lib/supabase/client";
import { callFunction } from "@/lib/supabase/call-function";
import { DEFAULT_TIMEZONE } from "@/lib/date/format";
import { Avatar } from "@/components/ui/avatar";
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

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
// Mesma validação frouxa já usada pela Edge Function `update-my-profile` —
// checagem client-side é só uma checagem antes do submit (CLAUDE.md, regra
// de UX 4), o servidor continua sendo quem valida de verdade.
const PHONE_PATTERN = /^[0-9+()\-\s]{8,20}$/;

type Tab = "perfil" | "configuracoes";

// /perfil — redesenhada (pedido do usuário) para ocupar toda a largura da
// tela de forma responsiva, no mesmo padrão de todo o resto do produto
// (título solto acima do conteúdo, cards em `bg-bg-card`, grid responsivo
// `p-8`, nunca um cartão único centralizado e estreito como antes) — mesmo
// padrão de abas já usado por /admin (`AdminTabs`), só que local a esta
// página (2 guias: "Perfil" — avatar/nome/telefone — e "Configurações" —
// fuso horário + preferências específicas de admin). A aba "Configurações"
// existe para crescer: hoje só tem fuso horário (todo usuário) e o toggle
// do botão de IA (só admin), mas é o lugar onde qualquer preferência nova
// por usuário deve entrar dali em diante.
export default function PerfilPage() {
  const {
    status,
    email,
    fullName,
    phone,
    avatarUrl,
    timezone,
    isAdmin,
    showAiRefreshButton,
    retry,
  } = useUserProfile();
  const [tab, setTab] = useState<Tab>("perfil");

  const [nameInput, setNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [selectedTimezone, setSelectedTimezone] = useState(timezone);
  const [savingTimezone, setSavingTimezone] = useState(false);
  const [savingRefreshButton, setSavingRefreshButton] = useState(false);

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(
    null,
  );

  useEffect(() => {
    if (status !== "loaded") return;
    setNameInput(fullName ?? "");
    setPhoneInput(phone ?? "");
    setSelectedTimezone(timezone);
  }, [status, fullName, phone, timezone]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  function showError(err: unknown) {
    setToast({ type: "error", message: err instanceof Error ? err.message : BACKEND_ERROR_MESSAGE });
  }

  const profileDirty = nameInput.trim() !== (fullName ?? "") || phoneInput.trim() !== (phone ?? "");

  async function handleSaveProfile() {
    const trimmedName = nameInput.trim();
    const trimmedPhone = phoneInput.trim();
    if (!trimmedName) {
      setToast({ type: "error", message: "Nome não pode ficar vazio." });
      return;
    }
    if (trimmedPhone && !PHONE_PATTERN.test(trimmedPhone)) {
      setToast({ type: "error", message: "Telefone inválido." });
      return;
    }
    setSavingProfile(true);
    try {
      await callFunction("update-my-profile", { full_name: trimmedName, phone: trimmedPhone });
      setToast({ type: "success", message: "Dados do perfil atualizados." });
      retry();
    } catch (err) {
      showError(err);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setToast({ type: "error", message: "Selecione um arquivo de imagem." });
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setToast({ type: "error", message: "Imagem muito grande (máx. 5MB)." });
      return;
    }

    setUploadingAvatar(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error(BACKEND_ERROR_MESSAGE);

      // Nome fixo (sem extensão) + upsert — um único arquivo por usuário,
      // nunca acumula versões antigas; o content-type real é gravado como
      // metadata no upload, então o navegador renderiza certo mesmo sem
      // extensão na URL.
      const path = `${user.id}/avatar`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from("avatars").getPublicUrl(path);
      // Cache-busting — o mesmo path é reaproveitado a cada troca de foto,
      // então sem um parâmetro variável o navegador serviria a versão
      // antiga já cacheada.
      const avatarUrlWithCacheBust = `${publicUrlData.publicUrl}?v=${Date.now()}`;

      await callFunction("update-my-profile", { avatar_url: avatarUrlWithCacheBust });
      setToast({ type: "success", message: "Avatar atualizado." });
      retry();
    } catch (err) {
      showError(err);
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleRemoveAvatar() {
    setUploadingAvatar(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase.storage.from("avatars").remove([`${user.id}/avatar`]);
      }
      await callFunction("update-my-profile", { avatar_url: "" });
      setToast({ type: "success", message: "Avatar removido." });
      retry();
    } catch (err) {
      showError(err);
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleSaveTimezone() {
    setSavingTimezone(true);
    try {
      await callFunction("update-my-timezone", { timezone: selectedTimezone });
      setToast({ type: "success", message: "Fuso horário atualizado." });
      retry();
    } catch (err) {
      showError(err);
    } finally {
      setSavingTimezone(false);
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
      showError(err);
    } finally {
      setSavingRefreshButton(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-bold text-text-primary md:text-3xl">Perfil</h1>
        <p className="mt-1 text-sm text-text-secondary">Gerencie seus dados e preferências.</p>
      </div>

      <div className="border-b border-border-default">
        <nav className="flex gap-6">
          <TabButton active={tab === "perfil"} onClick={() => setTab("perfil")}>
            Perfil
          </TabButton>
          <TabButton active={tab === "configuracoes"} onClick={() => setTab("configuracoes")}>
            Configurações
          </TabButton>
        </nav>
      </div>

      {status === "loading" && (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-accent-blue" />
        </div>
      )}

      {status === "error" && <ErrorMessage message={BACKEND_ERROR_MESSAGE} onRetry={retry} />}

      {status === "loaded" && tab === "perfil" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
          <div className="rounded-xl border border-border-default bg-bg-card p-6">
            <div className="flex flex-col items-center gap-4 text-center">
              <Avatar name={fullName} avatarUrl={avatarUrl} size="xl" />
              <div className="flex flex-col items-center gap-2">
                <label
                  className={`cursor-pointer rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90 ${
                    uploadingAvatar ? "pointer-events-none opacity-60" : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {uploadingAvatar && <Spinner className="h-4 w-4 text-white" />}
                    Alterar foto
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarChange}
                    disabled={uploadingAvatar}
                  />
                </label>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    disabled={uploadingAvatar}
                    className="text-xs font-medium text-[#e0483e] hover:underline disabled:opacity-60"
                  >
                    Remover foto
                  </button>
                )}
              </div>
              <p className="text-xs text-text-tertiary">JPG ou PNG, até 5MB.</p>
            </div>
          </div>

          <div className="rounded-xl border border-border-default bg-bg-card p-6">
            <div className="flex max-w-md flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="email" className="text-sm font-medium text-text-primary">
                  E-mail
                </label>
                <input
                  id="email"
                  value={email ?? ""}
                  disabled
                  className="rounded-md border border-border-default bg-bg-page px-3 py-2 text-sm text-text-secondary"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="full_name" className="text-sm font-medium text-text-primary">
                  Nome completo
                </label>
                <input
                  id="full_name"
                  value={nameInput}
                  onChange={(event) => setNameInput(event.target.value)}
                  disabled={savingProfile}
                  className="rounded-md border border-border-default px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue disabled:opacity-60"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="phone" className="text-sm font-medium text-text-primary">
                  Telefone
                </label>
                <input
                  id="phone"
                  value={phoneInput}
                  onChange={(event) => setPhoneInput(event.target.value)}
                  placeholder="(11) 98765-4321"
                  disabled={savingProfile}
                  className="rounded-md border border-border-default px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue disabled:opacity-60"
                />
              </div>

              <button
                type="button"
                onClick={handleSaveProfile}
                disabled={savingProfile || !profileDirty}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 sm:w-auto"
              >
                {savingProfile && <Spinner className="h-4 w-4 text-white" />}
                Salvar dados
              </button>
            </div>
          </div>
        </div>
      )}

      {status === "loaded" && tab === "configuracoes" && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-border-default bg-bg-card p-6">
            <h2 className="text-sm font-bold text-text-primary">Fuso horário</h2>
            <p className="mt-1 text-xs text-text-tertiary">
              Usado para exibir datas e horários em todo o produto.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <select
                id="timezone"
                value={selectedTimezone}
                onChange={(event) => setSelectedTimezone(event.target.value)}
                disabled={savingTimezone}
                className="rounded-md border border-border-default px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue disabled:opacity-60"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleSaveTimezone}
                disabled={savingTimezone || selectedTimezone === timezone}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 sm:w-auto"
              >
                {savingTimezone && <Spinner className="h-4 w-4 text-white" />}
                Salvar
              </button>
            </div>
          </div>

          {isAdmin && (
            <div className="rounded-xl border border-border-default bg-bg-card p-6">
              <h2 className="text-sm font-bold text-text-primary">Administração</h2>
              <p className="mt-1 text-xs text-text-tertiary">
                Preferências visíveis só para administradores.
              </p>
              <div className="mt-4 flex flex-col gap-1">
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
                <p className="mt-1 text-xs text-text-tertiary">
                  Fica desligado por padrão (não aparece em apresentações do produto). Ligue
                  para forçar a recomposição do resumo executivo em desenvolvimento/testes.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${
        active
          ? "border-accent-blue text-accent-blue"
          : "border-transparent text-text-secondary hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}
