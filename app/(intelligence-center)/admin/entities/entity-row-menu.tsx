"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Mesmo padrão de UserRowMenu (app/(intelligence-center)/admin/users/
// user-row-menu.tsx) — painel via portal em document.body, pra escapar do
// overflow-x-auto da tabela (ver comentário original lá para o detalhe).
export function EntityRowMenu({
  isActive,
  disabled = false,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  isActive: boolean;
  disabled?: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        panelRef.current &&
        !panelRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    function handleScrollOrResize() {
      setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open]);

  function handleToggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((current) => !current);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        aria-label="Ações"
        className="rounded-md px-2 py-1 text-text-tertiary hover:bg-bg-page hover:text-text-primary disabled:opacity-50"
      >
        ⋮
      </button>
      {open &&
        !disabled &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: position.top, right: position.right }}
            className="fixed z-50 w-48 rounded-md border border-border-default bg-bg-card py-1 shadow-lg"
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
              className="block w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-bg-page"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onToggleActive();
              }}
              className="block w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-bg-page"
            >
              {isActive ? "Desativar" : "Reativar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="block w-full px-4 py-2 text-left text-sm text-[#a52820] hover:bg-[#fdecea]"
            >
              Excluir Entidade
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
