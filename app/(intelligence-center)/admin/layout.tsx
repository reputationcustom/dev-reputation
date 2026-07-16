import type { ReactNode } from "react";
import { AdminTabs } from "@/components/intelligence-center/admin-tabs";

// Chrome compartilhado por toda a área /admin — guias "Usuários"/"FinOps"/
// "Entidades"/"Sincronização" (pedido do usuário: FinOps virou uma guia de
// Administração, não mais uma opção própria no menu lateral; as demais
// seguiram o mesmo padrão). O gate is_admin continua em cada page.tsx
// (users/page.tsx, finops/page.tsx, entities/page.tsx, sync-console/page.tsx)
// — este layout não faz nenhuma checagem própria, só o chrome visual.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="px-6 pt-6">
      <div className="mx-auto max-w-6xl">
        <AdminTabs />
      </div>
      {children}
    </div>
  );
}
