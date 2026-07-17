// Ícones do menu lateral (Sidebar) — usados só no rail colapsado
// (sidebar.tsx), pedido do usuário 2026-07-16: os pontos coloridos do rail
// (herdados do protótipo original, ver CLAUDE.md "Prototype-parity pass")
// não davam nenhuma pista visual de qual página cada um representa, mesmo
// com um tooltip — o usuário só descobre passando o mouse item por item.
// Um ícone por página resolve isso de relance, sem precisar do hover.
//
// Desenhados à mão (sem lucide-react/heroicons ou qualquer lib nova) —
// mesmo princípio já usado pelo logo (`public/logo.svg`, <img> simples) e
// pelos gráficos deste projeto (SVG cru, nunca uma lib de charting nova):
// não introduzir uma dependência só por um punhado de ícones pequenos.
// Todos herdam a cor do elemento pai via `stroke="currentColor"` — o
// `NavLink` que os usa já decide a cor (ativo/inativo/hover) via classes de
// texto, sem precisar de uma prop `active` neste componente.
import type { SVGProps } from "react";

function IconBase(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

// Radar de Eventos — círculos concêntricos + "blip", remete a um radar de
// detecção (event-radar).
function RadarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx={10} cy={10} r={7} />
      <circle cx={10} cy={10} r={3.75} />
      <circle cx={10} cy={10} r={0.9} fill="currentColor" stroke="none" />
      <path d="M10 10 14.5 5.5" />
    </IconBase>
  );
}

// Visão Geral — grade 2x2 (dashboard).
function OverviewIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x={3} y={3} width={6} height={6} rx={1} />
      <rect x={11} y={3} width={6} height={6} rx={1} />
      <rect x={3} y={11} width={6} height={6} rx={1} />
      <rect x={11} y={11} width={6} height={6} rx={1} />
    </IconBase>
  );
}

// Narrativas — documento com linhas de texto.
function NarrativesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M5.5 3h6l3 3v10.5a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M11.5 3v3h3" />
      <path d="M7 11h6M7 14h6M7 8h2.5" />
    </IconBase>
  );
}

// Sentimento — rosto sorridente.
function SentimentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx={10} cy={10} r={7} />
      <path d="M6.8 11.8c.9 1.1 2 1.7 3.2 1.7s2.3-.6 3.2-1.7" />
      <circle cx={7.4} cy={8.1} r={0.9} fill="currentColor" stroke="none" />
      <circle cx={12.6} cy={8.1} r={0.9} fill="currentColor" stroke="none" />
    </IconBase>
  );
}

// Plataformas — camadas empilhadas (múltiplas redes/fontes).
function PlatformsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M10 3 3 7.5 10 12 17 7.5Z" />
      <path d="M3 12 10 16.5 17 12" />
    </IconBase>
  );
}

// Pautas Eleitorais — bandeira (pauta/tema em destaque).
function ThemesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M5.5 17V3" />
      <path d="M5.5 4h9.5l-2.2 3.25L15 10.5H5.5" />
    </IconBase>
  );
}

// Autores e Influenciadores — pessoas.
function AuthorsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx={7.5} cy={7} r={2.75} />
      <circle cx={14} cy={8.5} r={2.1} />
      <path d="M3 17c.5-3.2 2.3-4.9 4.5-4.9s4 1.7 4.5 4.9" />
      <path d="M12.7 17c.4-2.1 1.6-3.4 3.3-3.75" />
    </IconBase>
  );
}

// Alertas — sino.
function AlertsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M10 3.5a4 4 0 0 0-4 4v2.75L4.5 13.5h11L14 10.25V7.5a4 4 0 0 0-4-4Z" />
      <path d="M8.4 16.5a1.7 1.7 0 0 0 3.2 0" />
    </IconBase>
  );
}

// Comunicação — balão de fala.
function CommunicationsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3.5 5.75A2.25 2.25 0 0 1 5.75 3.5h8.5a2.25 2.25 0 0 1 2.25 2.25v5.5a2.25 2.25 0 0 1-2.25 2.25H8.5l-3.5 2.75v-2.75h-.25a2.25 2.25 0 0 1-2.25-2.25Z" />
    </IconBase>
  );
}

// Relatórios — documento com barras (gráfico).
function ReportsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x={3.25} y={3} width={13.5} height={14} rx={1.5} />
      <path d="M7 13.25V9.5M10 13.25V6.5M13 13.25v-3" />
    </IconBase>
  );
}

// Administração — engrenagem.
function AdminIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx={10} cy={10} r={2.6} />
      <path d="M10 3v2.1M10 14.9V17M3 10h2.1M14.9 10H17M5.1 5.1l1.5 1.5M13.4 13.4l1.5 1.5M5.1 14.9l1.5-1.5M13.4 6.6l1.5-1.5" />
    </IconBase>
  );
}

// Ajuda — interrogação em círculo.
function HelpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx={10} cy={10} r={7.25} />
      <path d="M7.7 8a2.3 2.3 0 1 1 3.4 2c-.75.5-1.1.9-1.1 1.85" />
      <circle cx={10} cy={14.15} r={0.9} fill="currentColor" stroke="none" />
    </IconBase>
  );
}

// Perfil — pessoa (avatar genérico).
function ProfileIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx={10} cy={7} r={3.35} />
      <path d="M3.25 17c.75-3.7 3.3-5.65 6.75-5.65s6 1.95 6.75 5.65" />
    </IconBase>
  );
}

const NAV_ICON_BY_HREF: Record<string, (props: SVGProps<SVGSVGElement>) => React.JSX.Element> = {
  "/radar": RadarIcon,
  "/overview": OverviewIcon,
  "/narratives": NarrativesIcon,
  "/sentiment": SentimentIcon,
  "/platforms": PlatformsIcon,
  "/themes": ThemesIcon,
  "/authors": AuthorsIcon,
  "/alerts": AlertsIcon,
  "/communications": CommunicationsIcon,
  // 2 páginas desde 2026-07-17 (Relatório Executivo/Personalizado, ver
  // .dev/specs/executive-reports/overview.md) — mesmo ícone pras duas,
  // mesmo critério já usado por "Administração" (1 ícone pra várias guias).
  "/reports/executive": ReportsIcon,
  "/reports/custom": ReportsIcon,
  "/admin/users": AdminIcon,
  "/help": HelpIcon,
  "/perfil": ProfileIcon,
};

// Fallback — nunca deve aparecer de fato (todo item de NAV_ITEMS/
// ANALYSIS_ITEMS/ACTIONS_ITEMS/SETTINGS_ITEMS tem uma entrada acima), mas
// evita uma tela em branco no rail se um item novo for adicionado sem
// atualizar este mapa.
function FallbackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx={10} cy={10} r={2} fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function NavIcon({ href, className }: { href: string; className?: string }) {
  const Icon = NAV_ICON_BY_HREF[href] ?? FallbackIcon;
  return <Icon className={className} />;
}
