"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Guias de "Administração" — pedido do usuário: FinOps deixa de ser uma
// opção própria no menu lateral e vira uma 2ª guia aqui, ao lado de
// Usuários. Compartilhado por app/(intelligence-center)/admin/layout.tsx,
// renderizado acima de {children} tanto em /admin/users quanto em
// /admin/finops. "Entidades" (3ª guia) — Cadastro Nacional de Entidades
// (.dev/specs/entities/entity-registration.md), mesmo gate is_admin, cada
// page.tsx segue fazendo sua própria checagem.
const ADMIN_TABS = [
  { href: "/admin/users", label: "Usuários" },
  { href: "/admin/finops", label: "FinOps" },
  { href: "/admin/entities", label: "Entidades" },
];

export function AdminTabs() {
  const pathname = usePathname();

  return (
    <div className="border-b border-border-default">
      <nav className="flex gap-6">
        {ADMIN_TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${
                active
                  ? "border-accent-blue text-accent-blue"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
