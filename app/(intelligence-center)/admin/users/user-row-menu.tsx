"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// O painel do menu é renderizado via portal em document.body (posição
// `fixed`, coordenadas calculadas a partir do botão "⋮") em vez de
// `absolute` dentro da célula da tabela. A tabela de usuários vive num
// container com `overflow-x-auto` (users-admin-view.tsx) — por spec CSS,
// isso força `overflow-y` a também clipar (não fica "visible" quando
// `overflow-x` não é), então um painel `absolute` que ultrapassasse a
// borda do container ficava cortado/escondido atrás do restante da
// tabela. Portal escapa desse container de overflow, então o menu sempre
// aparece por cima, inteiro.
export function UserRowMenu({
  isPrincipal,
  banned,
  disabled = false,
  onEditOrganizations,
  onToggleRevoke,
  onDelete,
}: {
  isPrincipal: boolean;
  banned: boolean;
  disabled?: boolean;
  onEditOrganizations: () => void;
  onToggleRevoke: () => void;
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
            className="fixed z-50 w-56 rounded-md border border-border-default bg-bg-card py-1 shadow-lg"
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onEditOrganizations();
              }}
              className="block w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-bg-page"
            >
              Editar organizações
            </button>
            {!isPrincipal && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onToggleRevoke();
                }}
                className="block w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-bg-page"
              >
                {banned ? "Restaurar acesso" : "Revogar acesso"}
              </button>
            )}
            {!isPrincipal && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
                className="block w-full px-4 py-2 text-left text-sm text-[#a52820] hover:bg-[#fdecea]"
              >
                Excluir usuário
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
