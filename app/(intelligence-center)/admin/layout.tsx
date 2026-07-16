import type { ReactNode } from "react";
import { AdminTabs } from "@/components/intelligence-center/admin-tabs";

// Chrome compartilhado por toda a área /admin — guias "Usuários"/"FinOps"/
// "Entidades"/"Sincronização" (pedido do usuário: FinOps virou uma guia de
// Administração, não mais uma opção própria no menu lateral; as demais
// seguiram o mesmo padrão). O gate is_admin continua em cada page.tsx
// (users/page.tsx, finops/page.tsx, entities/page.tsx, sync-console/page.tsx)
// — este layout não faz nenhuma checagem própria, só o chrome visual.
//
// ✅ Sem `max-w-*` (2026-07-16, pedido do usuário: "toda a estrutura
// localizada em admin está utilizando menos espaço em tela do que o
// restante da aplicação... melhore a responsividade para não termos scroll
// horizontal"). Cada view (`*-admin-view.tsx`) também tinha seu próprio
// `mx-auto max-w-5xl/6xl` interno — removido junto, mesma razão. As 5
// páginas de análise nunca tiveram nenhum teto de largura (só `p-8`), então
// /admin agora usa a largura real disponível igual a elas, em vez de ficar
// artificialmente estreito num monitor largo.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="px-6 pt-6">
      <AdminTabs />
      {children}
    </div>
  );
}
