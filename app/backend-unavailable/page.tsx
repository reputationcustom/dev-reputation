import { ErrorMessage } from "@/components/ui/error-message";
import { BACKEND_ERROR_MESSAGE } from "@/lib/errors";

// Destino de redirect do middleware.ts quando a checagem de sessão falha por
// erro de comunicação com o Supabase (rede/DNS/timeout) ou variável de
// ambiente ausente — ver CLAUDE.md, "Falha de comunicação com o Supabase no
// middleware" (2026-07-16). middleware.ts nunca aplica a checagem de auth
// para esta rota (mesmo bypass de "/"), então ela sempre renderiza mesmo com
// o backend inteiramente fora do ar — não depende de nenhum cliente
// Supabase, nem client-side nem server-side.
export default async function BackendUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = next && next.startsWith("/") && next !== "/backend-unavailable" ? next : "/";

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-page px-4">
      <div className="w-full max-w-md text-center">
        <ErrorMessage message={BACKEND_ERROR_MESSAGE} />
        <a
          href={target}
          className="mt-4 inline-block text-sm font-medium text-accent-blue hover:underline"
        >
          Tentar novamente
        </a>
      </div>
    </main>
  );
}
