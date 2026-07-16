import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SyncConsoleAdminView } from "./sync-console-admin-view";

// Módulo `sync-console` (.dev/specs/sync-console/overview.md) — mesmo gate
// de admin/users|finops|entities/page.tsx (a rota nunca renderiza para
// não-admin, mesmo digitando a URL direto).
export default async function SyncConsoleAdminPage() {
  const supabase = await createClient();

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

  if (error) {
    throw new Error("Não foi possível verificar permissões de administrador.");
  }

  if (!profile?.is_admin) {
    redirect("/overview");
  }

  return <SyncConsoleAdminView />;
}
