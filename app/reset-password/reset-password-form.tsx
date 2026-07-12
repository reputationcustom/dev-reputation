"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AuthCard } from "@/components/ui/auth-card";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";
import { BACKEND_ERROR_MESSAGE } from "@/lib/errors";

// 3 estados obrigatórios pra todo fetch de carregamento inicial (ver
// CLAUDE.md, "Falha de comunicação com o backend") — "erro" é distinto de
// "invalid" (link de recuperação genuinamente expirado/usado): erro é
// quando a própria checagem de sessão falhou (rede/backend), não quando ela
// respondeu e não havia sessão.
type SessionState = "checking" | "valid" | "invalid" | "error";

export function ResetPasswordForm() {
  const router = useRouter();
  const [sessionState, setSessionState] = useState<SessionState>("checking");
  const [sessionCheckAttempt, setSessionCheckAttempt] = useState(0);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    setSessionState((current) => (current === "valid" ? current : "checking"));

    // O SDK troca o token de recuperação da URL por uma sessão válida
    // automaticamente ao carregar (detectSessionInUrl) — só precisamos
    // confirmar se ela existe. getSession() nunca lança exceção — devolve
    // { data, error } —, então o campo error precisa ser checado
    // explicitamente (nunca só o caminho feliz de `data`).
    supabase.auth
      .getSession()
      .then(({ data: { session }, error }) => {
        if (error) {
          setSessionState((current) => (current === "valid" ? current : "error"));
          return;
        }
        setSessionState((current) =>
          current === "valid" ? current : session ? "valid" : "invalid",
        );
      })
      .catch(() => {
        setSessionState((current) => (current === "valid" ? current : "error"));
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setSessionState("valid");
      }
    });

    return () => subscription.unsubscribe();
  }, [sessionCheckAttempt]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    let hasError = false;
    let nextPasswordError: string | null = null;
    let nextConfirmError: string | null = null;

    if (password.length < 6) {
      nextPasswordError = "Senha deve ter pelo menos 6 caracteres";
      hasError = true;
    }

    if (confirmPassword !== password) {
      nextConfirmError = "As senhas não coincidem";
      hasError = true;
    }

    setPasswordError(nextPasswordError);
    setConfirmError(nextConfirmError);
    if (hasError) return;

    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setFormError("Algo deu errado. Tente novamente.");
        return;
      }

      // Não faz login automático — força reautenticação explícita.
      await supabase.auth.signOut();
      router.push("/login?resetSuccess=1");
    } catch {
      setFormError("Algo deu errado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  if (sessionState === "checking") {
    return (
      <AuthCard title="Redefinir senha">
        <div className="flex justify-center py-6">
          <Spinner className="h-6 w-6 text-accent-blue" />
        </div>
      </AuthCard>
    );
  }

  if (sessionState === "error") {
    return (
      <AuthCard title="Redefinir senha">
        <ErrorMessage
          message={BACKEND_ERROR_MESSAGE}
          onRetry={() => setSessionCheckAttempt((current) => current + 1)}
        />
      </AuthCard>
    );
  }

  if (sessionState === "invalid") {
    return (
      <AuthCard title="Redefinir senha">
        <ErrorMessage message="Link expirado ou inválido. Solicite um novo." />
        <Link
          href="/forgot-password"
          className="mt-6 block text-center text-sm text-accent-blue hover:underline"
        >
          Solicitar novo link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Redefinir senha">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {formError && (
          <p className="rounded-md bg-[#fdecea] px-3 py-2 text-sm text-[#a52820]" role="alert">
            {formError}
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium text-text-primary">
            Nova senha
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={loading}
            className="rounded-md border border-border-default px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue disabled:opacity-60"
          />
          {passwordError && <p className="text-xs text-[#e0483e]">{passwordError}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="confirmPassword" className="text-sm font-medium text-text-primary">
            Confirmar nova senha
          </label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={loading}
            className="rounded-md border border-border-default px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue disabled:opacity-60"
          />
          {confirmError && <p className="text-xs text-[#e0483e]">{confirmError}</p>}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {loading && <Spinner className="h-4 w-4 text-white" />}
          Redefinir senha
        </button>
      </form>
    </AuthCard>
  );
}
