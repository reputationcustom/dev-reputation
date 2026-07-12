"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AuthCard } from "@/components/ui/auth-card";
import { Spinner } from "@/components/ui/spinner";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError("E-mail obrigatório");
      return;
    }
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setEmailError("E-mail inválido");
      return;
    }
    setEmailError(null);

    setLoading(true);
    try {
      const supabase = createClient();
      await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      // Sempre mostra a mesma confirmação, exista ou não o e-mail —
      // proteção contra enumeração de contas, ver password-recovery.md.
      setSubmitted(true);
    } catch {
      setFormError("Algo deu errado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <AuthCard title="Verifique seu e-mail">
        <p className="text-sm text-text-secondary">
          Se esse e-mail estiver cadastrado, você receberá instruções para
          redefinir sua senha em alguns minutos.
        </p>
        <Link
          href="/login"
          className="mt-6 block text-center text-sm text-accent-blue hover:underline"
        >
          Voltar para o login
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Esqueceu a senha?"
      subtitle="Enviaremos instruções de redefinição para o seu e-mail."
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
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

        <button
          type="submit"
          disabled={loading}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {loading && <Spinner className="h-4 w-4 text-white" />}
          Enviar instruções
        </button>

        <Link href="/login" className="text-center text-sm text-accent-blue hover:underline">
          Voltar para o login
        </Link>
      </form>
    </AuthCard>
  );
}
