"use client";

import { useMemo, useState } from "react";
import type { AuthorRow } from "@reputation/shared-types";
import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { useUserProfile } from "@/hooks/use-user-profile";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { AuthorsList } from "@/components/intelligence-center/authors-list";
import { XInsightsPanel } from "@/components/intelligence-center/x-insights-panel";
import { AuthorScatterChart } from "@/components/intelligence-center/charts/author-scatter-chart";
import { AuthorMentionsByIdeology, AuthorSentimentByIdeology } from "@/components/intelligence-center/author-ideology-breakdown";
import { AuthorPartyBreakdown } from "@/components/intelligence-center/author-party-breakdown";
import { AuthorDetailPanel } from "@/components/intelligence-center/author-detail-panel";
import { AuthorFiltersToolbar, EMPTY_AUTHOR_FILTERS, type AuthorFiltersState } from "@/components/intelligence-center/author-filters-toolbar";
import { dominantSentiment } from "@/components/intelligence-center/author-color";
import { EmptyState } from "@/components/ui/empty-state";

// "Autores e Influenciadores" — ✅ implementada 2026-07-25 (widgets
// "Perfis relevantes"/"X Themes", movidos de `/platforms`) — ✅
// **redesenhada 2026-08-01** (.dev/specs/intelligence-center/
// authors-and-influencers.md, "Redesenho interativo"), pedido do usuário:
// "revise a página e o backend de autores e influenciadores e sugira
// novas visualizações integrando com a tabela entities... totalmente
// interativa... partido, ideologia, menções, sentimentos." Substitui o
// widget "Perfis relevantes" (só a tabela) por um painel completo — toda a
// interatividade (filtros/ordenação/cor) roda no client sobre
// `envelope.authors` já carregado, sem chamada de rede nova por interação
// (ver a spec, "Regras de negócio").

const numberFormatCompact = new Intl.NumberFormat("pt-BR", { notation: "compact" });

function applyFilters(authors: AuthorRow[], filters: AuthorFiltersState): AuthorRow[] {
  return authors.filter((author) => {
    if (filters.search && !author.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.partido && author.entity_partido !== filters.partido) return false;
    if (filters.onlyLinked && !author.entity_id) return false;
    if (filters.ideologies.size > 0 && !(author.entity_ideologia && filters.ideologies.has(author.entity_ideologia))) return false;
    if (filters.sentiment && dominantSentiment(author) !== filters.sentiment) return false;
    return true;
  });
}

export default function AuthorsPage() {
  const { status, envelope, retry } = usePageEnvelope("get-page-authors");
  const { isAdmin, timezone } = useUserProfile();
  const [filters, setFilters] = useState<AuthorFiltersState>(EMPTY_AUTHOR_FILTERS);
  const [selectedAuthor, setSelectedAuthor] = useState<AuthorRow | null>(null);

  const allAuthors = useMemo(() => envelope?.authors ?? [], [envelope]);
  const filteredAuthors = useMemo(() => applyFilters(allAuthors, filters), [allAuthors, filters]);

  const linkedCount = filteredAuthors.filter((a) => a.entity_id).length;
  const totalMentions = filteredAuthors.reduce((sum, a) => sum + a.mentions, 0);
  const withSentiment = filteredAuthors.filter((a) => dominantSentiment(a) !== null);
  const avgNet = withSentiment.length
    ? Math.round(withSentiment.reduce((sum, a) => sum + ((a.sentiment_positive ?? 0) - (a.sentiment_negative ?? 0)), 0) / withSentiment.length)
    : null;
  const avgNetLabel =
    avgNet === null ? "sem dado suficiente" : avgNet > 15 ? "predominantemente positivo" : avgNet < -15 ? "predominantemente negativo" : "neutro";
  const partidoCount = new Set(filteredAuthors.map((a) => a.entity_partido).filter(Boolean)).size;

  return (
    <>
      <PageHeaderBar title="Autores e Influenciadores" subtitle="Ranking e perfil de autores e influenciadores." />

      <div className="flex flex-col gap-6 p-8">
        <WidgetCard title="Autores e Influenciadores" status={status} onRetry={retry}>
          {allAuthors.length === 0 ? (
            <EmptyState message="Ainda sincronizando autores para este escopo." />
          ) : (
            <div className="flex flex-col gap-5">
              <AuthorFiltersToolbar authors={allAuthors} filters={filters} onChange={setFilters} />

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-border-default bg-bg-card p-4">
                  <p className="text-xs font-bold uppercase text-text-primary">Autores no filtro</p>
                  <p className="mt-1 text-2xl font-bold text-text-primary">{filteredAuthors.length}</p>
                  <p className="mt-0.5 text-xs text-text-secondary">{linkedCount} vinculados a uma Entity</p>
                </div>
                <div className="rounded-xl border border-border-default bg-bg-card p-4">
                  <p className="text-xs font-bold uppercase text-text-primary">Menções totais</p>
                  <p className="mt-1 text-2xl font-bold text-text-primary">{numberFormatCompact.format(totalMentions)}</p>
                  <p className="mt-0.5 text-xs text-text-secondary">soma do período selecionado</p>
                </div>
                <div className="rounded-xl border border-border-default bg-bg-card p-4">
                  <p className="text-xs font-bold uppercase text-text-primary">Sentimento médio</p>
                  <p className="mt-1 text-2xl font-bold text-text-primary">{avgNet === null ? "—" : `${avgNet > 0 ? "+" : ""}${avgNet}`}</p>
                  <p className="mt-0.5 text-xs text-text-secondary">{avgNetLabel}</p>
                </div>
                <div className="rounded-xl border border-border-default bg-bg-card p-4">
                  <p className="text-xs font-bold uppercase text-text-primary">Partidos distintos</p>
                  <p className="mt-1 text-2xl font-bold text-text-primary">{partidoCount}</p>
                  <p className="mt-0.5 text-xs text-text-secondary">no filtro atual</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
                <div className="rounded-xl border border-border-default bg-bg-card p-5">
                  <h3 className="text-sm font-bold text-text-primary">Alcance × Sentimento</h3>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    Cada ponto é um autor — tamanho do ponto = engajamento. Clique para abrir o perfil.
                  </p>
                  <div className="mt-3">
                    <AuthorScatterChart authors={filteredAuthors} colorBy={filters.colorBy} onSelectAuthor={setSelectedAuthor} />
                  </div>
                </div>
                <div className="rounded-xl border border-border-default bg-bg-card p-5">
                  <h3 className="text-sm font-bold text-text-primary">Menções por ideologia</h3>
                  <p className="mt-0.5 text-xs text-text-secondary">Clique numa barra para filtrar.</p>
                  <div className="mt-3">
                    <AuthorMentionsByIdeology
                      authors={filteredAuthors}
                      activeIdeologies={filters.ideologies}
                      onToggleIdeology={(ideology) => {
                        const next = new Set(filters.ideologies);
                        if (next.has(ideology)) next.delete(ideology);
                        else next.add(ideology);
                        setFilters({ ...filters, ideologies: next });
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-border-default bg-bg-card p-5">
                  <h3 className="text-sm font-bold text-text-primary">Sentimento médio por ideologia</h3>
                  <p className="mt-0.5 text-xs text-text-secondary">Distribuição positivo/neutro/negativo entre autores enriquecidos por Entity.</p>
                  <div className="mt-3">
                    <AuthorSentimentByIdeology authors={filteredAuthors} />
                  </div>
                </div>
                <div className="rounded-xl border border-border-default bg-bg-card p-5">
                  <h3 className="text-sm font-bold text-text-primary">Top partidos por alcance</h3>
                  <p className="mt-0.5 text-xs text-text-secondary">Soma de alcance no filtro atual, por partido.</p>
                  <div className="mt-3">
                    <AuthorPartyBreakdown authors={filteredAuthors} onSelectPartido={(partido) => setFilters({ ...filters, partido })} />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-bold text-text-primary">Ranking completo</h3>
                <AuthorsList authors={filteredAuthors} onSelectAuthor={setSelectedAuthor} />
              </div>
            </div>
          )}
        </WidgetCard>

        <WidgetCard title="X Themes (Hashtags, Posters, Stories, Emojis)" status={status} onRetry={retry}>
          <XInsightsPanel items={envelope?.x_insights ?? []} timezone={timezone} />
        </WidgetCard>
      </div>

      {selectedAuthor && (
        <AuthorDetailPanel
          author={selectedAuthor}
          colorBy={filters.colorBy}
          onClose={() => setSelectedAuthor(null)}
          canRegisterEntity={isAdmin}
        />
      )}
    </>
  );
}
