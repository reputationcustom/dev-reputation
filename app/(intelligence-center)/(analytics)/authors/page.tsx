"use client";

import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { AuthorsList } from "@/components/intelligence-center/authors-list";
import { XInsightsPanel } from "@/components/intelligence-center/x-insights-panel";

// Autores e Influenciadores (`/authors`) — ✅ implementada 2026-07-25,
// pedido do usuário: mover "Perfis relevantes" e "X Themes" (Hashtags/
// Most Mentioned X Posters/Top Stories/Top Emojis) de `/platforms` pra
// cá, já que são sobre autores, não sobre plataformas. Mesmos 2 widgets,
// mesmos componentes (`AuthorsList`/`XInsightsPanel`), agora alimentados
// por `get-page-authors` (novo, `PAGE_BLOCKS.authors = ['authors',
// 'x_insights']`) em vez de `get-page-platforms`. Substitui o placeholder
// `ComingSoonPage` que existia aqui (fora de `(analytics)`, sem
// organização/período) — ver CLAUDE.md.
export default function AuthorsPage() {
  const { status, envelope, retry } = usePageEnvelope("get-page-authors");

  return (
    <>
      <PageHeaderBar title="Autores e Influenciadores" subtitle="Ranking e perfil de autores e influenciadores." />

      <div className="flex flex-col gap-6 p-8">
        <WidgetCard title="Perfis relevantes" status={status} onRetry={retry}>
          <AuthorsList authors={envelope?.authors ?? []} />
        </WidgetCard>

        <WidgetCard title="X Themes (Hashtags, Posters, Stories, Emojis)" status={status} onRetry={retry}>
          <XInsightsPanel items={envelope?.x_insights ?? []} />
        </WidgetCard>
      </div>
    </>
  );
}
