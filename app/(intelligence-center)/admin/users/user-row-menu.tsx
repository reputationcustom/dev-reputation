"use client";

import { useEffect, useRef, useState } from "react";

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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-label="Ações"
        className="rounded-md px-2 py-1 text-text-tertiary hover:bg-bg-page hover:text-text-primary disabled:opacity-50"
      >
        ⋮
      </button>
      {open && !disabled && (
        <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-border-default bg-bg-card py-1 shadow-lg">
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
        </div>
      )}
    </div>
  );
}
