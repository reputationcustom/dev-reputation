// Placeholder para itens de menu que já existem na IA do protótipo
// (Comunicacao Inteligente.dc.html) mas cuja tela ainda não foi
// especificada/implementada (Autores e Influenciadores, Alertas,
// Relatórios, Ajuda — ver `.dev/specs/_index.md` "Módulos", sprints 3/4
// ainda não iniciados). Pedido do usuário 2026-07-13: manter a opção de
// menu visível e clicável, mas indicar claramente que está pendente de
// desenvolvimento em vez de link morto ou item desabilitado.
export function ComingSoonPage({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-bold text-text-primary md:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
      </div>

      <div className="flex flex-col items-center justify-center gap-3 rounded-[10px] border border-border-default bg-bg-card px-6 py-20 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-blue-bg text-2xl">
          🚧
        </div>
        <p className="text-sm font-bold text-text-primary">Funcionalidade em desenvolvimento</p>
        <p className="max-w-md text-sm text-text-secondary">
          Esta área ainda não foi implementada. Volte em breve para acompanhar as novidades.
        </p>
      </div>
    </div>
  );
}
