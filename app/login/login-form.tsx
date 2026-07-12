"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AuthCard } from "@/components/ui/auth-card";
import { Spinner } from "@/components/ui/spinner";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm({
  next,
  showResetSuccess = false,
}: {
  next?: string;
  showResetSuccess?: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const trimmedEmail = email.trim();
    let hasError = false;
    let nextEmailError: string | null = null;
    let nextPasswordError: string | null = null;

    if (!trimmedEmail) {
      nextEmailError = "E-mail obrigatório";
      hasError = true;
    } else if (!EMAIL_REGEX.test(trimmedEmail)) {
      nextEmailError = "E-mail inválido";
      hasError = true;
    }

    if (!password) {
      nextPasswordError = "Senha obrigatória";
      hasError = true;
    }

    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (hasError) return;

    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        setFormError("E-mail ou senha incorretos");
        return;
      }

      router.push(next && next.startsWith("/") ? next : "/overview");
      router.refresh();
    } catch {
      setFormError("Algo deu errado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Entrar">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {showResetSuccess && !formError && (
          <p className="rounded-md bg-[#eafaf1] px-3 py-2 text-sm text-[#1a9d5c]" role="status">
            Senha redefinida, faça login com a nova senha.
          </p>
        )}
        {formError && (
          <p className="rounded-md bg-[#fdecea] px-3 py-2 text-sm text-[#a52820]" role="alert">
            {formError}
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium text-text-primary">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={loading}
            className="rounded-md border border-border-default px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue disabled:opacity-60"
          />
          {emailError && <p className="text-xs text-[#e0483e]">{emailError}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium text-text-primary">
            Senha
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={loading}
            className="rounded-md border border-border-default px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue disabled:opacity-60"
          />
          {passwordError && <p className="text-xs text-[#e0483e]">{passwordError}</p>}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {loading && <Spinner className="h-4 w-4 text-white" />}
          Entrar
        </button>

        <Link
          href="/forgot-password"
          className="text-center text-sm text-accent-blue hover:underline"
        >
          Esqueceu a senha?
        </Link>
      </form>
    </AuthCard>
  );
}
