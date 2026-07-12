"use client";

import { useState } from "react";
import { Sidebar } from "@/components/intelligence-center/sidebar";
import { IntelligenceCenterProvider } from "@/components/intelligence-center/header-context";

// Shell compartilhado por toda a aplicação autenticada — não só as 5
// páginas de análise, também /admin/users e /perfil (module auth), ver
// intelligence-center/overview.md, "Premissas de shell/layout" (2026-07-15):
// menu/header/footer fixos (item 3, garantido pelo App Router — este
// layout não remonta ao navegar, só o `children` troca), responsivo (item
// 2, ver `mobileMenuOpen` abaixo) e menu ocultável com forma óbvia de
// reabrir (item 1, ver `sidebarCollapsed`/rail «»). O gate de "sem
// organização ainda" fica no layout aninhado
// `(analytics)/layout.tsx` — não se aplica a /admin/users nem /perfil,
// que não dependem de organização ativa.
export default function IntelligenceCenterLayout({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <IntelligenceCenterProvider>
      <div className="flex min-h-screen bg-bg-page">
        <div className="hidden lg:flex">
          <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed((v) => !v)} />
        </div>

        {mobileMenuOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileMenuOpen(false)} />
            <div className="relative z-10">
              <Sidebar collapsed={false} onToggleCollapse={() => setMobileMenuOpen(false)} onNavigate={() => setMobileMenuOpen(false)} />
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-border-default bg-bg-card px-4 py-3 lg:hidden">
            <span className="text-sm font-bold text-text-primary">Digital Intelligent Communication</span>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menu"
              className="rounded-md border border-border-default px-3 py-1.5 text-sm text-text-primary"
            >
              Menu
            </button>
          </div>

          <main className="flex min-w-0 flex-1 flex-col">{children}</main>

          <footer className="border-t border-border-default bg-bg-card px-8 py-3 text-xs text-text-tertiary">
            Digital Intelligent Communication
          </footer>
        </div>
      </div>
    </IntelligenceCenterProvider>
  );
}
