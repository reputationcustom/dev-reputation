import { redirect } from "next/navigation";

// "/reports" deixou de ser um destino final em 2026-07-17 — virou 2
// páginas (Relatório Executivo/Relatório Personalizado, ver
// .dev/specs/executive-reports/overview.md, "Integração com o menu").
// Redirect simples de servidor pra preservar qualquer link/bookmark
// antigo — não é a rota "/" em si, então a regra de "nunca redirecionar
// na raiz" (CLAUDE.md, "Deploy (Hostinger)") não se aplica aqui.
export default function ReportsPage() {
  redirect("/reports/executive");
}
