import { ComingSoonPage } from "@/components/intelligence-center/coming-soon";

// Spec pronta, não implementada — .dev/specs/executive-reports/overview.md
// e custom-report.md. Pedido do usuário 2026-07-17: por ora, só a entrada
// de menu + esta tela "em desenvolvimento".
export default function CustomReportPage() {
  return (
    <ComingSoonPage
      title="Relatório Personalizado"
      description="Escolha o período, os blocos de dado e se quer um resumo gerado por IA — monte seu próprio relatório e exporte em PDF."
    />
  );
}
