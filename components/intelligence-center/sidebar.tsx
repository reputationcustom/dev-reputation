"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserProfile } from "@/hooks/use-user-profile";

const NAV_ITEMS = [{ href: "/overview", label: "Visão Geral" }];

const ANALYSIS_ITEMS = [
  { href: "/narratives", label: "Narrativas" },
  { href: "/sentiment", label: "Sentimento" },
  { href: "/platforms", label: "Plataformas" },
  { href: "/themes", label: "Pautas Eleitorais" },
];

function NavLink({ href, label, collapsed, onNavigate }: { href: string; label: string; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  // Collapsed (rail) mode: a single dot, not a truncated label — matches the
  // prototype's rail (48px, `width:8px;height:8px;border-radius:50%` dots),
  // avoids the earlier bug where a nav item collapsed to a single letter.
  if (collapsed) {
    return (
      <Link
        href={href}
        onClick={onNavigate}
        title={label}
        aria-label={label}
        className="flex items-center justify-center rounded-md py-2.5 transition-colors hover:bg-bg-sidebar-active"
      >
        <span className={`h-2 w-2 rounded-full ${active ? "bg-accent-blue" : "bg-text-sidebar-inactive"}`} />
      </Link>
    );
  }

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`block truncate rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-bg-sidebar-active text-white"
          : "text-text-sidebar-inactive hover:bg-bg-sidebar-active hover:text-white"
      }`}
    >
      {label}
    </Link>
  );
}

// Menu lateral compartilhado por toda a aplicação autenticada
// (intelligence-center/overview.md, "Premissas de shell/layout": item 1
// "menu sempre visível, exceto se o usuário ocultá-lo explicitamente" +
// item 3 "fixo, nunca recarrega ao navegar"). `collapsed` vem do layout
// (`app/(intelligence-center)/layout.tsx`) — como o layout não remonta
// entre navegações do App Router, o estado persiste sozinho dentro da
// sessão, sem precisar de localStorage/contexto extra.
export function Sidebar({
  collapsed,
  onToggleCollapse,
  onNavigate,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigate?: () => void;
}) {
  const { isAdmin } = useUserProfile();

  return (
    <aside
      className={`flex h-screen flex-shrink-0 flex-col bg-bg-sidebar px-3 py-6 transition-[width] ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      <div className="flex items-center justify-between px-1">
        {!collapsed && (
          <span className="truncate text-sm font-bold text-white">Digital Intelligent Communication</span>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expandir menu" : "Ocultar menu"}
          title={collapsed ? "Expandir menu" : "Ocultar menu"}
          className="flex-shrink-0 rounded-md p-2 text-text-sidebar-inactive hover:bg-bg-sidebar-active hover:text-white"
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      <nav className="mt-8 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} collapsed={collapsed} onNavigate={onNavigate} {...item} />
        ))}
      </nav>

      <div className="mt-6">
        {!collapsed && (
          <p className="px-3 text-xs font-semibold uppercase tracking-wide text-text-sidebar-section-label">
            Análises
          </p>
        )}
        <nav className="mt-2 flex flex-col gap-1">
          {ANALYSIS_ITEMS.map((item) => (
            <NavLink key={item.href} collapsed={collapsed} onNavigate={onNavigate} {...item} />
          ))}
        </nav>
      </div>

      <div className="mt-auto flex flex-col gap-1 pt-6">
        {isAdmin && <NavLink href="/admin/users" label="Administração" collapsed={collapsed} onNavigate={onNavigate} />}
        <NavLink href="/perfil" label="Perfil" collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </aside>
  );
}
