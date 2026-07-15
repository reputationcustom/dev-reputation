"use client";

import { useEffect, useRef, useState } from "react";
import type { TopicSortMode } from "@reputation/shared-types";
import { ErrorMessage } from "@/components/ui/error-message";
import { Toast } from "@/components/ui/toast";
import { formatDateOnly } from "@/lib/date/format";
import { PERIOD_MODE_OPTIONS, useIntelligenceCenterHeader } from "./header-context";

// ✅ 2026-08-09 (migration 20260809130000) — pedido do usuário: "no
// frontend adicionaremos essa opção para o usuário selecionar qual a
// perspectiva ele deseja acompanhar. Default deve ser trending." Controla
// o critério de ranking de tags/positive_topics/negative_topics
// (get_narratives_table) e term_signals (get_term_signals) — Tendência
// (crescimento) ou Volume (menções absolutas). Só as 6 páginas que
// renderizam conteúdo derivado de tópicos passam `topicSort`/
// `onTopicSortChange` (ver usePageEnvelope) — nas demais o par de props
// fica indefinido e o toggle simplesmente não renderiza.
export const TOPIC_SORT_OPTIONS: { mode: TopicSortMode; label: string }[] = [
  { mode: "trending", label: "Tendência" },
  { mode: "volume", label: "Volume" },
];

// Header global (2 seletores — organização ativa e período — ver
// intelligence-center/executive-overview.md, "Header"). Especificado uma
// única vez, reusado pelas 5 páginas via IntelligenceCenterProvider — sem
// seletor de Query (pedido explícito do usuário, ver mesma spec).
// Chips presentacionais, mesmo conjunto do protótipo original — sem
// onClick de propósito: o protótipo em si não tem filtragem real nesses
// chips, e o backend (sql-aggregation.md) só resolve `filters.narratives`
// hoje. Reproduzir a afordância de navegação sem inventar filtragem que
// não existe (Princípio 2 — sem lógica de negócio no frontend).
const FILTRO_CHIPS = [
  "Plataforma",
  "Idioma",
  "Região",
  "Sentimento",
  "Narrativa",
  "Pauta",
  "Tipo de autor",
  "Alcance",
  "Nível de risco",
];

// `title` é opcional: a página de detalhe de Narrativa
// (narratives/[id]/page.tsx) já renderiza seu próprio <h1> + badges no
// corpo quando carregada, então nesse caso ela não passa `title` aqui, pra
// não duplicar o mesmo texto duas vezes empilhado (só os 3 estados
// loading/erro/não-encontrado, que não têm h1 próprio, passam um título
// genérico).
//
// `hidePeriodSelector` — ✅ 2026-07-14, pedido do usuário, exclusivo pra
// `/radar`: o seletor de período (Diário/Semanal/Mensal + range custom)
// não tem efeito sobre a aba "Lista" do widget (janela FIXA de 72h, ver
// event-radar/frontend-highlights-feed.md) e só afeta a aba "Resumo
// executivo" de forma indireta (via `get-page-overview`) — mostrar um
// seletor cujo efeito prático é quase todo invisível nesta página
// específica confundia mais do que ajudava. Default `false` — toda outra
// página continua mostrando o seletor normalmente.
export function PageHeaderBar({
  title,
  subtitle,
  hidePeriodSelector = false,
  topicSort,
  onTopicSortChange,
}: {
  title?: string;
  subtitle?: string;
  hidePeriodSelector?: boolean;
  topicSort?: TopicSortMode;
  onTopicSortChange?: (mode: TopicSortMode) => void;
}) {
  const {
    organizations,
    organizationsStatus,
    retryOrganizations,
    organizationId,
    setOrganizationId,
    defaultOrganizationId,
    isSettingDefaultOrganization,
    setCurrentOrganizationAsDefault,
    periodMode,
    setPeriodMode,
    customRange,
    setCustomRange,
  } = useIntelligenceCenterHeader();
  const [filtrosOpen, setFiltrosOpen] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const isCurrentOrganizationDefault =
    organizationId !== null && organizationId === defaultOrganizationId;

  async function handleSetDefaultOrganization() {
    try {
      await setCurrentOrganizationAsDefault();
      setToast({ type: "success", message: "Organização definida como padrão." });
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Não foi possível salvar. Tente novamente.",
      });
    }
  }

  return (
    <div>
      {/* Barra de controles (organização/período/filtros) — fundo branco,
          separada do título por design (ver protótipo real: o título da
          página não fica dentro dessa barra, fica solto no corpo da
          página, ver bloco abaixo). Revisão de paridade 2026-07-12: a
          versão anterior colocava o <h1> dentro desta mesma barra branca,
          divergindo do protótipo. */}
      <div className="flex flex-col gap-4 border-b border-border-default bg-bg-card px-8 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {organizationsStatus === "error" && (
              <ErrorMessage message="Não foi possível carregar suas organizações." onRetry={retryOrganizations} />
            )}

            {organizationsStatus === "loaded" && organizations.length > 1 && (
              <div className="flex items-center gap-1">
                <select
                  value={organizationId ?? ""}
                  onChange={(event) => setOrganizationId(event.target.value)}
                  className="rounded-md border border-border-default px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleSetDefaultOrganization}
                  disabled={isCurrentOrganizationDefault || isSettingDefaultOrganization}
                  aria-label={
                    isCurrentOrganizationDefault
                      ? "Esta é a sua organização padrão"
                      : "Definir esta organização como padrão"
                  }
                  title={
                    isCurrentOrganizationDefault
                      ? "Esta é a sua organização padrão"
                      : "Definir esta organização como padrão"
                  }
                  className={`rounded-md border border-border-default px-2 py-2 text-sm transition-colors ${
                    isCurrentOrganizationDefault
                      ? "cursor-default text-accent-blue"
                      : "text-text-tertiary hover:bg-bg-page disabled:opacity-50"
                  }`}
                >
                  {isSettingDefaultOrganization ? "…" : isCurrentOrganizationDefault ? "★" : "☆"}
                </button>
              </div>
            )}

            {!hidePeriodSelector && (
              <>
                <div className="flex rounded-md border border-border-default p-0.5">
                  {PERIOD_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.mode}
                      type="button"
                      onClick={() => setPeriodMode(option.mode)}
                      className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                        periodMode === option.mode
                          ? "bg-accent-blue text-white"
                          : "text-text-secondary hover:bg-bg-page"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {periodMode === "custom" && (
                  <CustomRangePicker range={customRange} onChange={setCustomRange} />
                )}
              </>
            )}

            {topicSort && onTopicSortChange && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-text-tertiary">Perspectiva:</span>
                <div className="flex rounded-md border border-border-default p-0.5">
                  {TOPIC_SORT_OPTIONS.map((option) => (
                    <button
                      key={option.mode}
                      type="button"
                      onClick={() => onTopicSortChange(option.mode)}
                      className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                        topicSort === option.mode
                          ? "bg-accent-blue text-white"
                          : "text-text-secondary hover:bg-bg-page"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setFiltrosOpen((current) => !current)}
            className="rounded-md border border-border-default px-3 py-2 text-sm font-semibold text-text-primary hover:bg-bg-page"
          >
            Filtros {filtrosOpen ? "▲" : "▼"}
          </button>
        </div>

        {filtrosOpen && (
          <div className="flex flex-col gap-2 rounded-md border border-border-default bg-bg-page p-4">
            <p className="text-xs font-semibold text-text-secondary">FILTROS AVANÇADOS</p>
            <div className="flex flex-wrap gap-2">
              {FILTRO_CHIPS.map((label) => (
                <span
                  key={label}
                  className="rounded-full bg-bg-card px-3 py-1.5 text-xs font-medium text-text-secondary"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Título da página — solto no canvas cinza, não dentro da barra
          branca acima (ver comentário no bloco anterior). */}
      {title && (
        <div className="px-8 pt-6">
          <h1 className="text-2xl font-bold text-text-primary md:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>}
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} />}
    </div>
  );
}

// Popover com 2 campos de data — abre preenchido com o intervalo atual
// (nunca vazio, ver header-context.tsx). "Aplicar" só confirma se
// start <= end, senão mantém o popover aberto com o erro inline (mesmo
// padrão de validação client-side do resto do produto, CLAUDE.md "Regras
// transversais de UX" #4).
function CustomRangePicker({
  range,
  onChange,
}: {
  range: { start: string; end: string };
  onChange: (range: { start: string; end: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(range);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(range);
    setError(null);
  }, [open, range]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleApply() {
    if (draft.start > draft.end) {
      setError("A data inicial precisa ser anterior à data final.");
      return;
    }
    onChange(draft);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="rounded-md border border-border-default px-3 py-2 text-sm font-medium text-text-primary hover:bg-bg-page"
      >
        {formatDateOnly(range.start)} – {formatDateOnly(range.end)}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-border-default bg-bg-card p-4 shadow-lg">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
              Data inicial
              <input
                type="date"
                value={draft.start}
                max={draft.end}
                onChange={(event) => setDraft((current) => ({ ...current, start: event.target.value }))}
                className="rounded-md border border-border-default px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-blue"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
              Data final
              <input
                type="date"
                value={draft.end}
                min={draft.start}
                onChange={(event) => setDraft((current) => ({ ...current, end: event.target.value }))}
                className="rounded-md border border-border-default px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-blue"
              />
            </label>
            {error && <p className="text-xs text-[#e0483e]">{error}</p>}
            <button
              type="button"
              onClick={handleApply}
              className="mt-1 rounded-md bg-accent-blue px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
