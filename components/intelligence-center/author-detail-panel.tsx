"use client";

import type { AuthorRow } from "@reputation/shared-types";
import {
  authorColorHex,
  authorInitials,
  dominantSentiment,
  ideologyBadgeClass,
  ideologyLabel,
  SENTIMENT_HEX,
  SENTIMENT_LABEL,
  type ColorByMode,
} from "./author-color";

// Painel de detalhe (slide-over lateral, não modal central — pra continuar
// vendo o restante da página) — .dev/specs/intelligence-center/
// authors-and-influencers.md, "Redesenho interativo". Aberto por clique num
// ponto da dispersão ou numa linha da tabela.

const numberFormat = new Intl.NumberFormat("pt-BR");
const decimalFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function AuthorDetailPanel({
  author,
  colorBy,
  onClose,
  canRegisterEntity,
}: {
  author: AuthorRow;
  colorBy: ColorByMode;
  onClose: () => void;
  // "+ Cadastrar Entidade" só visível pra admin — ver
  // entities/entity-registration.md e entities/author-linking.md,
  // "Cadastro rápido a partir de um autor já visto". Cadastro em si (o
  // EntityFormModal pré-preenchido) fica para quando entity-registration.md
  // for implementada — este painel já deixa o ponto de entrada pronto.
  canRegisterEntity: boolean;
}) {
  const sentiment = dominantSentiment(author);
  const ideoBadge = ideologyBadgeClass(author.entity_ideologia);
  const net = author.sentiment_positive !== null ? (author.sentiment_positive ?? 0) - (author.sentiment_negative ?? 0) : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-full w-full max-w-sm flex-col overflow-y-auto border-l border-border-default bg-bg-card p-6">
        <div className="flex items-start justify-between">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold text-white"
            style={{ backgroundColor: authorColorHex(author, colorBy) }}
            aria-hidden
          >
            {authorInitials(author.name)}
          </span>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-lg text-text-tertiary hover:text-text-primary">
            ✕
          </button>
        </div>

        <h3 className="mt-3 text-lg font-bold text-text-primary">{author.name}</h3>
        <p className="text-sm text-text-secondary">{author.entity_cargo ?? "Cargo não informado"}</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {author.entity_partido && (
            <span className="inline-flex items-center rounded-full bg-bg-page px-2.5 py-1 text-xs font-semibold text-text-secondary">
              {author.entity_partido}
            </span>
          )}
          {ideoBadge && (
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${ideoBadge.bg} ${ideoBadge.text}`}>
              {ideologyLabel(author.entity_ideologia)}
            </span>
          )}
          {!author.entity_id && (
            <span className="inline-flex items-center rounded-full border border-border-default px-2.5 py-1 text-xs font-semibold text-text-tertiary">
              Sem vínculo com Entity
            </span>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <div className="rounded-lg bg-bg-page p-3">
            <div className="text-[10px] font-bold uppercase text-text-tertiary">Menções</div>
            <div className="text-lg font-bold text-text-primary">{numberFormat.format(author.mentions)}</div>
          </div>
          <div className="rounded-lg bg-bg-page p-3">
            <div className="text-[10px] font-bold uppercase text-text-tertiary">Alcance</div>
            <div className="text-lg font-bold text-text-primary">{numberFormat.format(author.reach)}</div>
          </div>
          <div className="rounded-lg bg-bg-page p-3">
            <div className="text-[10px] font-bold uppercase text-text-tertiary">Engajamento</div>
            <div className="text-lg font-bold text-text-primary">{decimalFormat.format(author.engagement)}</div>
          </div>
          <div className="rounded-lg bg-bg-page p-3">
            <div className="text-[10px] font-bold uppercase text-text-tertiary">Sentimento líquido</div>
            <div className="text-lg font-bold text-text-primary">{net === null ? "—" : `${net > 0 ? "+" : ""}${net}`}</div>
          </div>
        </div>

        <div className="mt-5 text-xs font-bold uppercase text-text-tertiary">Distribuição de sentimento</div>
        {sentiment && author.sentiment_positive !== null && author.sentiment_neutral !== null && author.sentiment_negative !== null ? (
          <div
            className="mt-2 flex h-5 overflow-hidden rounded"
            title={`Positivo ${author.sentiment_positive}% · Neutro ${author.sentiment_neutral}% · Negativo ${author.sentiment_negative}%`}
          >
            <div className="h-full bg-sentiment-positive" style={{ width: `${author.sentiment_positive}%` }} />
            <div className="h-full bg-sentiment-neutral" style={{ width: `${author.sentiment_neutral}%` }} />
            <div className="h-full bg-sentiment-negative" style={{ width: `${author.sentiment_negative}%` }} />
          </div>
        ) : (
          <p className="mt-2 text-xs italic text-text-tertiary">Sem dado de sentimento (fora do top autores enriquecidos).</p>
        )}
        {sentiment && (
          <p className="mt-1.5 text-xs" style={{ color: SENTIMENT_HEX[sentiment] }}>
            Predominantemente {SENTIMENT_LABEL[sentiment].toLowerCase()}
          </p>
        )}

        <div className="mt-5 text-xs font-bold uppercase text-text-tertiary">Narrativas/pautas associadas</div>
        {author.narrative_labels.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {author.narrative_labels.map((label) => (
              <span key={label} className="rounded-full bg-bg-page px-2 py-0.5 text-xs text-text-secondary">
                {label}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs italic text-text-tertiary">Nenhuma no escopo atual.</p>
        )}

        {!author.entity_id && canRegisterEntity && (
          <button
            type="button"
            className="mt-6 rounded-md border border-accent-blue px-3 py-2 text-sm font-medium text-accent-blue hover:bg-accent-blue-bg"
          >
            + Cadastrar Entidade
          </button>
        )}
      </div>
    </div>
  );
}
