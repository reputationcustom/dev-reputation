import { ComingSoonPage } from "@/components/intelligence-center/coming-soon";

// Spec pronta, não implementada — .dev/specs/executive-reports/overview.md
// e executive-report.md. Pedido do usuário 2026-07-17: por ora, só a
// entrada de menu + esta tela "em desenvolvimento".
export default function ExecutiveReportPage() {
  return (
    <ComingSoonPage
      title="Relatório Executivo"
      description="Panorama geral do período escolhido — KPIs, sentimento, evolução no tempo, principais Narrativas/autores/termos e um resumo executivo gerado por IA, exportável em PDF."
    />
  );
}
