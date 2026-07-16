"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserProfile } from "@/hooks/use-user-profile";
import { NavIcon } from "./nav-icons";
import { Tooltip } from "@/components/ui/tooltip";

// Módulo `event-radar` — pedido do usuário (2026-08-02): página dedicada
// além do widget de /overview, mesmo feed fixo de 72h ("o que ocorreu,
// quais foram as tendências"), só que como destino próprio no menu, não
// só embutido na Visão Geral. Ver event-radar/frontend-highlights-feed.md.
// Posicionado acima de "Visão Geral" (pedido do usuário) — nenhum dos dois
// tem um rótulo de seção acima, então a ordem do array já é a ordem visual.
const NAV_ITEMS = [
  { href: "/radar", label: "Radar de Eventos" },
  { href: "/overview", label: "Visão Geral" },
];

const ANALYSIS_ITEMS = [
  { href: "/narratives", label: "Narrativas" },
  { href: "/sentiment", label: "Sentimento" },
  { href: "/platforms", label: "Plataformas" },
  { href: "/themes", label: "Pautas Eleitorais" },
  { href: "/authors", label: "Autores e Influenciadores" },
];

// "Ações" — itens que representam uma ação sobre a Narrativa/organização,
// não uma visualização analítica (por isso vivem fora de "Análises").
// "Alertas" movido de "Configurações" pra cá, acima de "Comunicação"
// (pedido do usuário) — módulo `communications` (Sprint 2.1) é quem deu
// origem à seção, ver .dev/specs/communications/overview.md.
const ACTIONS_ITEMS = [
  { href: "/alerts", label: "Alertas" },
  { href: "/communications", label: "Comunicação" },
];

// Mesmos rótulos da seção "CONFIGURAÇÕES" do protótipo
// (Comunicacao Inteligente.dc.html — `navSettings`). No protótipo esses
// itens ficam sempre desabilitados/estáticos; aqui são links reais —
// Relatórios/Ajuda abrem uma tela "em desenvolvimento"
// (components/intelligence-center/coming-soon.tsx), Administração é a
// única já implementada de verdade (gated por isAdmin, ver abaixo).
const SETTINGS_ITEMS = [{ href: "/reports", label: "Relatórios" }];

function NavLink({
  href,
  label,
  collapsed,
  onNavigate,
  matchPrefix,
}: {
  href: string;
  label: string;
  collapsed: boolean;
  onNavigate?: () => void;
  // Ex: "Administração" (/admin/users) também deve aparecer ativo em
  // /admin/finops (guia irmã, mesma seção — ver admin/layout.tsx). Sem
  // isso, o match padrão (href exato/prefixo do próprio href) nunca
  // destacaria o item ao navegar pra uma guia diferente da apontada pelo
  // link.
  matchPrefix?: string;
}) {
  const pathname = usePathname();
  const active = matchPrefix
    ? pathname === matchPrefix || pathname.startsWith(`${matchPrefix}/`)
    : pathname === href || pathname.startsWith(`${href}/`);

  // Collapsed (rail) mode: an icon representing the page + a hover tooltip
  // with its label — pedido do usuário 2026-07-16. Antes disso era um
  // ponto colorido sem nenhuma pista visual de qual página cada um
  // representa (herdado do protótipo, ver CLAUDE.md "Prototype-parity
  // pass") — o usuário só descobria passando o mouse item por item, sem
  // conseguir reconhecer a página de relance. `title`/`aria-label` no
  // `<Link>` continuam (leitores de tela e o tooltip nativo do navegador
  // como fallback), mas o `Tooltip` compartilhado (`components/ui/tooltip.tsx`,
  // `position="right"` — evita o corte na borda esquerda da tela que um
  // tooltip centralizado sofreria numa coluna de 64px) é o que de fato
  // aparece ao passar o mouse.
  if (collapsed) {
    return (
      <Link
        href={href}
        onClick={onNavigate}
        title={label}
        aria-label={label}
        className={`flex items-center justify-center rounded-md py-2.5 transition-colors hover:bg-bg-sidebar-active hover:text-white ${
          active ? "text-accent-blue" : "text-text-sidebar-inactive"
        }`}
      >
        <Tooltip text={label} position="right">
          <NavIcon href={href} className="h-5 w-5" />
        </Tooltip>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`block truncate rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        // Item ativo usa accent-blue — mesma cor da seleção dos botões de
        // período no header (page-header-bar.tsx), pedido do usuário
        // 2026-07-12 ("deixar o destaque em azul claro, mesma cor da
        // seleção dos botões de período"). Antes usava bg-sidebar-active
        // (navy escuro), quase invisível contra o fundo navy da própria
        // sidebar.
        active
          ? "bg-accent-blue text-white"
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
      className={`sticky top-0 flex min-h-screen flex-shrink-0 flex-col self-start bg-bg-sidebar px-3 py-6 transition-[width] ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      {/* Logo placeholder (public/logo.svg, ver CLAUDE.md sobre tamanho
          recomendado) — visível tanto expandido quanto no rail colapsado,
          pedido do usuário 2026-07-12 ("imagem que eu possa substituir pela
          logo"). */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 px-1">
          <img src="/logo.svg" alt="Comunicação Inteligente" className="h-7 w-7 rounded-md" />
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expandir menu"
            title="Expandir menu"
            className="rounded-md p-2 text-text-sidebar-inactive hover:bg-bg-sidebar-active hover:text-white"
          >
            »
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between px-1">
          <div className="flex min-w-0 items-center gap-2">
            <img src="/logo.svg" alt="Comunicação Inteligente" className="h-8 w-8 flex-shrink-0 rounded-md" />
            <span className="text-sm font-bold leading-tight text-white">
              Comunicação
              <br />
              Inteligente
            </span>
          </div>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Ocultar menu"
            title="Ocultar menu"
            className="flex-shrink-0 rounded-md p-2 text-text-sidebar-inactive hover:bg-bg-sidebar-active hover:text-white"
          >
            «
          </button>
        </div>
      )}

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

      <div className="mt-6">
        {!collapsed && (
          <p className="px-3 text-xs font-semibold uppercase tracking-wide text-text-sidebar-section-label">
            Ações
          </p>
        )}
        <nav className="mt-2 flex flex-col gap-1">
          {ACTIONS_ITEMS.map((item) => (
            <NavLink key={item.href} collapsed={collapsed} onNavigate={onNavigate} {...item} />
          ))}
        </nav>
      </div>

      <div className="mt-auto pt-6">
        {!collapsed && (
          <p className="px-3 text-xs font-semibold uppercase tracking-wide text-text-sidebar-section-label">
            Configurações
          </p>
        )}
        <nav className="mt-2 flex flex-col gap-1">
          {SETTINGS_ITEMS.map((item) => (
            <NavLink key={item.href} collapsed={collapsed} onNavigate={onNavigate} {...item} />
          ))}
          {/* Administração é a única real (gated por isAdmin) entre as do
              protótipo — Ajuda continua estática (tela "em desenvolvimento").
              4 guias por dentro (Usuários/FinOps/Entidades/Sincronização,
              admin/admin-tabs.tsx) — pedido do usuário: FinOps deixou de ser
              uma opção própria do menu e virou guia aqui, mesmo padrão
              seguido pelas guias adicionadas depois. matchPrefix="/admin"
              mantém o item destacado em qualquer uma das 4 guias, não só
              /admin/users. */}
          {isAdmin && (
            <NavLink
              href="/admin/users"
              matchPrefix="/admin"
              label="Administração"
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          )}
          <NavLink href="/help" label="Ajuda" collapsed={collapsed} onNavigate={onNavigate} />
          {/* Perfil não existe na IA do protótipo (sem avatar/seção de
              usuário na tela original) — mantido por ser funcionalidade
              real já implementada (auth module, timezone), não uma opção
              de menu do design a reproduzir. */}
          <NavLink href="/perfil" label="Perfil" collapsed={collapsed} onNavigate={onNavigate} />
        </nav>
      </div>
    </aside>
  );
}
