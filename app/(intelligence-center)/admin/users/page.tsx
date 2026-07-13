import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UsersAdminView } from "./users-admin-view";

export default async function AdminUsersPage() {
  const supabase = await createClient();

  // Sessão já é garantida pelo middleware (.dev/specs/auth/login.md,
  // "Proteção de rota") — aqui só falta o gate extra de is_admin
  // (.dev/specs/auth/user-management.md: "a rota nunca renderiza para
  // não-admin, mesmo digitando a URL direto"). Filtro explícito por `id`,
  // não só a RLS — a policy de leitura de `user_profiles` passou a devolver
  // mais de uma linha em alguns casos (RLS ampliada por outro motivo, fora
  // deste arquivo), e `.single()` sem `.eq('id', ...)` trata ">1 linha"
  // como erro — "meu próprio perfil" nunca deveria depender implicitamente
  // da RLS ser estreita o bastante pra isso.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Não foi possível verificar permissões de administrador.");
  }

  const { data: profile, error } = await supabase
    .from("user_profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  // Falha de comunicação com o backend (ver CLAUDE.md) nunca pode virar
  // silenciosamente "não é admin" — isso mandaria um admin de verdade pra
  // /overview num erro transitório de rede/DB. Propaga pro error boundary
  // (app/error.tsx) em vez de assumir um valor padrão.
  if (error) {
    throw new Error("Não foi possível verificar permissões de administrador.");
  }

  if (!profile?.is_admin) {
    redirect("/overview");
  }

  return <UsersAdminView />;
}
