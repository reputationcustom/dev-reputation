import { Skeleton } from "@/components/ui/skeleton";
import { ErrorMessage } from "@/components/ui/error-message";

// Card de widget padrão — cada widget de cada página carrega/erra/mostra
// vazio de forma independente (executive-overview.md/sentiment-analysis.md/
// etc.: "um widget falhar não derruba os outros"). `status` aqui é o status
// do envelope inteiro (um único fetch por página, ver
// service-layer-aggregation.md) — o "por widget" independente já é
// garantido no backend (cada bloco individualmente tenta/loga/cai pra
// vazio, nunca derruba o envelope), então na prática todo widget da mesma
// página compartilha o mesmo status de carregamento da chamada única.
export function WidgetCard({
  title,
  status,
  onRetry,
  children,
}: {
  title: string;
  status: "loading" | "error" | "loaded";
  onRetry: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border-default bg-bg-card p-5">
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      <div className="mt-4">
        {status === "loading" && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}
        {status === "error" && <ErrorMessage message="Não foi possível carregar este widget." onRetry={onRetry} />}
        {status === "loaded" && children}
      </div>
    </div>
  );
}
