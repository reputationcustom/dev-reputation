"use client";

import { useIntelligenceCenterHeader } from "@/components/intelligence-center/header-context";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";
import { EmptyState } from "@/components/ui/empty-state";

// Gate de organização (executive-overview.md, "Fluxos alternativos e
// erros": "Usuário sem nenhuma organização... Tela de estado vazio") —
// só se aplica às 5 páginas de análise (organização/período fazem parte
// do escopo delas), não a /admin/users nem /perfil, que ficam no layout
// pai (`(intelligence-center)/layout.tsx`) sem este gate.
export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const { organizationsStatus, organizations, retryOrganizations, organizationId } = useIntelligenceCenterHeader();

  if (organizationsStatus === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-6 w-6 text-accent-blue" />
      </div>
    );
  }

  if (organizationsStatus === "error") {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-md">
          <ErrorMessage message="Não foi possível carregar suas organizações." onRetry={retryOrganizations} />
        </div>
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState message="Você ainda não tem acesso a nenhuma organização." />
      </div>
    );
  }

  // organizationId só fica null entre "organizações carregadas" e o efeito
  // de auto-seleção rodar (mesmo tick de render) — janela de 1 frame,
  // mesmo tratamento de loading acima evita as páginas filhas chamarem a
  // Edge Function com organization_id vazio.
  if (!organizationId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-6 w-6 text-accent-blue" />
      </div>
    );
  }

  return <>{children}</>;
}
