"use client";

import { useMemo, useState } from "react";
import type { AuthorRow } from "@reputation/shared-types";
import { usePageEnvelope } from "@/hooks/use-page-envelope";
import { useUserProfile } from "@/hooks/use-user-profile";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { AuthorsList } from "@/components/intelligence-center/authors-list";
import { XInsightsPanel } from "@/components/intelligence-center/x-insights-panel";
import { TopSitesPanel } from "@/components/intelligence-center/top-sites-panel";
import { AuthorScatterChart } from "@/components/intelligence-center/charts/author-scatter-chart";
import { AuthorMentionsByIdeology, AuthorSentimentByIdeology } from "@/components/intelligence-center/author-ideology-breakdown";
import { AuthorPartyBreakdown } from "@/components/intelligence-center/author-party-breakdown";
import { AuthorEntityTypeBreakdown } from "@/components/intelligence-center/author-entity-type-breakdown";
import { AuthorDetractorsBoosters } from "@/components/intelligence-center/author-detractors-boosters";
import { AuthorNarrativeInvolvement } from "@/components/intelligence-center/author-narrative-involvement";
import { AuthorDetailPanel } from "@/components/intelligence-center/author-detail-panel";
import {
  AuthorGeneralFiltersToolbar,
  AuthorEntityFiltersToolbar,
  EMPTY_AUTHOR_FILTERS,
  type AuthorFiltersState,
} from "@/components/intelligence-center/author-filters-toolbar";
import { dominantSentiment } from "@/components/intelligence-center/author-color";
import { EmptyState } from "@/components/ui/empty-state";

// "Autores e Influenciadores" — ✅ redesenhada em 2 guias (2026-08-08),
// pedido do usuário: "1) Visualizar os autores genericamente: detratores,
// impulsionadores, alcance, engajamento, envolvimento em narrativas, etc.
// Top Autores, Top Sites, Top Stories. 2) Visualização por entidade... não
// só partido, mas imprensa, e outras organizações... na tabela entities."
//
// Guia "Visão Geral": todo autor do escopo, vinculado a uma Entity ou não —
// o objetivo é o comportamento observado (quem detrata/impulsiona, alcance,
// engajamento, em quais Narrativas aparece), sem depender de cadastro
// manual. Guia "Por Entidade": só autores já vinculados a uma Entity
// (`entity_id` não-nulo) — o objetivo é organizar por QUEM/O QUE aquele
// autor é (pessoa/partido/veículo de imprensa/instituição/empresa/
// movimento/outro), não só "menções". As duas leem o mesmo `envelope.authors`
// já carregado — trocar de guia nunca dispara uma chamada de rede nova,
// mesma regra de negócio de sempre desta página (ver
// .dev/specs/intelligence-center/authors-and-influencers.md).

const numberFormatCompact = new Intl.NumberFormat("pt-BR", { notation: "compact" });

function applyGeneralFilters(authors: AuthorRow[], filters: AuthorFiltersState): AuthorRow[] {
  return authors.filter((author) => {
    if (filters.search && !author.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.sentiment && dominantSentiment(author) !== filters.sentiment) return false;
    if (filters.narrativeLabel && !author.narrative_labels.includes(filters.narrativeLabel)) return false;
    return true;
  });
}

function applyEntityFilters(authors: AuthorRow[], filters: AuthorFiltersState): AuthorRow[] {
  return authors.filter((author) => {
    if (filters.search && !author.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.sentiment && dominantSentiment(author) !== filters.sentiment) return false;
    if (filters.partido && author.entity_partido !== filters.partido) return false;
    if (filters.entityTypes.size > 0 && !(author.entity_type && filters.entityTypes.has(author.entity_type))) return false;
    if (filters.ideologies.size > 0 && !(author.entity_ideologia && filters.ideologies.has(author.entity_ideologia))) return false;
    return true;
  });
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border-default bg-bg-card p-4">
      <p className="text-xs font-bold uppercase text-text-primary">{label}</p>
      <p className="mt-1 text-2xl font-bold text-text-primary">{value}</p>
      <p className="mt-0.5 text-xs text-text-secondary">{hint}</p>
    </div>
  );
}

export default function AuthorsPage() {
  const { status, envelope, retry } = usePageEnvelope("get-page-authors");
  const { isAdmin, timezone } = useUserProfile();
  const [activeTab, setActiveTab] = useState<"geral" | "entidade">("geral");
  const [filters, setFilters] = useState<AuthorFiltersState>(EMPTY_AUTHOR_FILTERS);
  const [selectedAuthor, setSelectedAuthor] = useState<AuthorRow | null>(null);

  const allAuthors = useMemo(() => envelope?.authors ?? [], [envelope]);
  const generalAuthors = useMemo(() => applyGeneralFilters(allAuthors, filters), [allAuthors, filters]);
  const linkedAuthors = useMemo(() => allAuthors.filter((a) => a.entity_id), [allAuthors]);
  const entityAuthors = useMemo(() => applyEntityFilters(linkedAuthors, filters), [linkedAuthors, filters]);

  const generalTotalMentions = generalAuthors.reduce((sum, a) => sum + a.mentions, 0);
  const generalTotalReach = generalAuthors.reduce((sum, a) => sum + a.reach, 0);
  const generalWithSentiment = generalAuthors.filter((a) => dominantSentiment(a) !== null);
  const generalAvgNet = generalWithSentiment.length
    ? Math.round(
        generalWithSentiment.reduce((sum, a) => sum + ((a.sentiment_positive ?? 0) - (a.sentiment_negative ?? 0)), 0) /
          generalWithSentiment.length,
      )
    : null;
  const generalAvgNetLabel =
    generalAvgNet === null
      ? "sem dado suficiente"
      : generalAvgNet > 15
        ? "predominantemente positivo"
        : generalAvgNet < -15
          ? "predominantemente negativo"
          : "neutro";

  const entityTotalMentions = entityAuthors.reduce((sum, a) => sum + a.mentions, 0);
  const entityTotalReach = entityAuthors.reduce((sum, a) => sum + a.reach, 0);
  const distinctEntityTypes = new Set(entityAuthors.map((a) => a.entity_type).filter(Boolean)).size;

  const detailColorBy = activeTab === "geral" ? "sentimento" : filters.colorBy;

  return (
    <>
      <PageHeaderBar title="Autores e Influenciadores" subtitle="Ranking e perfil de autores e influenciadores." />

      <div className="flex flex-col gap-6 p-8">
        <div className="flex overflow-hidden rounded-full border border-border-default self-start">
          <button
            type="button"
            onClick={() => setActiveTab("geral")}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === "geral" ? "bg-accent-blue text-white" : "bg-bg-card text-text-secondary hover:bg-bg-page"
            }`}
          >
            Visão Geral
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("entidade")}
            className={`border-l border-border-default px-4 py-2 text-sm font-medium ${
              activeTab === "entidade" ? "bg-accent-blue text-white" : "bg-bg-card text-text-secondary hover:bg-bg-page"
            }`}
          >
            Por Entidade
          </button>
        </div>

        {activeTab === "geral" ? (
          <>
            <WidgetCard title="Visão Geral de Autores" status={status} onRetry={retry}>
              {allAuthors.length === 0 ? (
                <EmptyState message="Ainda sincronizando autores para este escopo." />
              ) : (
                <div className="flex flex-col gap-5">
                  <AuthorGeneralFiltersToolbar filters={filters} onChange={setFilters} />

                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <KpiCard label="Autores no filtro" value={String(generalAuthors.length)} hint="quantos autores aparecem abaixo" />
                    <KpiCard
                      label="Menções totais"
                      value={numberFormatCompact.format(generalTotalMentions)}
                      hint="soma do período selecionado"
                    />
                    <KpiCard label="Alcance total" value={numberFormatCompact.format(generalTotalReach)} hint="soma do período selecionado" />
                    <KpiCard
                      label="Sentimento médio"
                      value={generalAvgNet === null ? "—" : `${generalAvgNet > 0 ? "+" : ""}${generalAvgNet}`}
                      hint={generalAvgNetLabel}
                    />
                  </div>

                  <div className="rounded-xl border border-border-default bg-bg-card p-5">
                    <h3 className="text-sm font-bold text-text-primary">Detratores e impulsionadores</h3>
                    <p className="mt-0.5 text-xs text-text-secondary">Autores com maior alcance entre os predominantemente negativos/positivos.</p>
                    <div className="mt-3">
                      <AuthorDetractorsBoosters authors={generalAuthors} onSelectAuthor={setSelectedAuthor} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
                    <div className="rounded-xl border border-border-default bg-bg-card p-5">
                      <h3 className="text-sm font-bold text-text-primary">Alcance × Sentimento</h3>
                      <p className="mt-0.5 text-xs text-text-secondary">
                        Cada ponto é um autor — tamanho do ponto = engajamento. Clique para abrir o perfil.
                      </p>
                      <div className="mt-3">
                        <AuthorScatterChart authors={generalAuthors} colorBy="sentimento" onSelectAuthor={setSelectedAuthor} />
                      </div>
                    </div>
                    <div className="rounded-xl border border-border-default bg-bg-card p-5">
                      <h3 className="text-sm font-bold text-text-primary">Envolvimento em narrativas</h3>
                      <p className="mt-0.5 text-xs text-text-secondary">Quantos autores distintos citam cada Narrativa/pauta. Clique para filtrar.</p>
                      <div className="mt-3">
                        <AuthorNarrativeInvolvement
                          authors={generalAuthors}
                          activeLabel={filters.narrativeLabel}
                          onSelectLabel={(narrativeLabel) => setFilters({ ...filters, narrativeLabel })}
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-bold text-text-primary">Top Autores</h3>
                    <AuthorsList authors={generalAuthors} variant="general" onSelectAuthor={setSelectedAuthor} />
                  </div>
                </div>
              )}
            </WidgetCard>

            <WidgetCard title="Conteúdo em destaque (Top Sites, X Themes)" status={status} onRetry={retry}>
              <div className="flex flex-col gap-6">
                <TopSitesPanel items={envelope?.top_sites ?? []} timezone={timezone} />
                <div className="border-t border-border-subtle pt-6">
                  <h3 className="mb-3 text-sm font-semibold text-text-primary">X Themes (Hashtags, Posters, Stories, Emojis)</h3>
                  <XInsightsPanel items={envelope?.x_insights ?? []} timezone={timezone} />
                </div>
              </div>
            </WidgetCard>
          </>
        ) : (
          <WidgetCard title="Autores por Entidade" status={status} onRetry={retry}>
            {linkedAuthors.length === 0 ? (
              <EmptyState message="Nenhum autor vinculado a uma Entity ainda neste escopo — cadastre partidos, veículos de imprensa ou outras organizações em /admin/entities e vincule contas em entity_accounts." />
            ) : (
              <div className="flex flex-col gap-5">
                <AuthorEntityFiltersToolbar authors={linkedAuthors} filters={filters} onChange={setFilters} />

                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <KpiCard label="Entidades vinculadas" value={String(entityAuthors.length)} hint="autores com Entity no filtro atual" />
                  <KpiCard label="Menções" value={numberFormatCompact.format(entityTotalMentions)} hint="soma das Entities no filtro" />
                  <KpiCard label="Alcance" value={numberFormatCompact.format(entityTotalReach)} hint="soma das Entities no filtro" />
                  <KpiCard label="Tipos de Entidade" value={String(distinctEntityTypes)} hint="distintos no filtro atual" />
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-border-default bg-bg-card p-5">
                    <h3 className="text-sm font-bold text-text-primary">Por tipo de Entidade</h3>
                    <p className="mt-0.5 text-xs text-text-secondary">Pessoa, partido, veículo de imprensa, instituição, empresa, movimento, outro.</p>
                    <div className="mt-3">
                      <AuthorEntityTypeBreakdown
                        authors={entityAuthors}
                        activeTypes={filters.entityTypes}
                        onToggleType={(type) => {
                          const next = new Set(filters.entityTypes);
                          if (next.has(type)) next.delete(type);
                          else next.add(type);
                          setFilters({ ...filters, entityTypes: next });
                        }}
                      />
                    </div>
                  </div>
                  <div className="rounded-xl border border-border-default bg-bg-card p-5">
                    <h3 className="text-sm font-bold text-text-primary">Top partidos por alcance</h3>
                    <p className="mt-0.5 text-xs text-text-secondary">Soma de alcance no filtro atual, por partido.</p>
                    <div className="mt-3">
                      <AuthorPartyBreakdown authors={entityAuthors} onSelectPartido={(partido) => setFilters({ ...filters, partido })} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-border-default bg-bg-card p-5">
                    <h3 className="text-sm font-bold text-text-primary">Menções por ideologia</h3>
                    <p className="mt-0.5 text-xs text-text-secondary">Clique numa barra para filtrar.</p>
                    <div className="mt-3">
                      <AuthorMentionsByIdeology
                        authors={entityAuthors}
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
                  <div className="rounded-xl border border-border-default bg-bg-card p-5">
                    <h3 className="text-sm font-bold text-text-primary">Sentimento médio por ideologia</h3>
                    <p className="mt-0.5 text-xs text-text-secondary">Distribuição positivo/neutro/negativo entre autores enriquecidos por Entity.</p>
                    <div className="mt-3">
                      <AuthorSentimentByIdeology authors={entityAuthors} />
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border-default bg-bg-card p-5">
                  <h3 className="text-sm font-bold text-text-primary">Alcance × Sentimento</h3>
                  <p className="mt-0.5 text-xs text-text-secondary">Cor conforme o controle &quot;Colorir por&quot; acima. Clique para abrir o perfil.</p>
                  <div className="mt-3">
                    <AuthorScatterChart authors={entityAuthors} colorBy={filters.colorBy} onSelectAuthor={setSelectedAuthor} />
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-bold text-text-primary">Entidades vinculadas</h3>
                  <AuthorsList
                    authors={entityAuthors}
                    variant="entity"
                    onSelectAuthor={setSelectedAuthor}
                    emptyMessage="Nenhuma Entity vinculada no filtro atual."
                  />
                </div>
              </div>
            )}
          </WidgetCard>
        )}
      </div>

      {selectedAuthor && (
        <AuthorDetailPanel
          author={selectedAuthor}
          colorBy={detailColorBy}
          onClose={() => setSelectedAuthor(null)}
          canRegisterEntity={isAdmin}
        />
      )}
    </>
  );
}
