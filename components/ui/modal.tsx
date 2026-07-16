export function Modal({
  title,
  onClose,
  children,
  maxWidthClassName = "max-w-md",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  // Comunicação/Decisão tem bastante campo condicional — precisa de mais
  // largura que o padrão (ex: "max-w-2xl"), ver communication-form-modal.tsx.
  maxWidthClassName?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className={`w-full ${maxWidthClassName} max-h-[90vh] overflow-y-auto rounded-xl bg-bg-card p-6 shadow-lg`}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-text-tertiary hover:text-text-primary"
          >
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
