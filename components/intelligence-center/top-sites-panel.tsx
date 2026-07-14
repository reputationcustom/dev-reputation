import type { TopSiteItem } from "@reputation/shared-types";
import { formatRelativeDate } from "@/lib/date/format";

// "Top Sites" — domínios de onde as menções se originam (bw_query_top_sites,
// data/volume/topsites/queries) — guia "Visão Geral" de Autores e
// Influenciadores (redesenho em 2 guias, 2026-08-08). Ver get_top_sites em
// sql-aggregation.md. Distinto de "Top Shared Sites" (domínios linkados
// DENTRO do conteúdo das menções) — esse continua sem bloco próprio.

const numberFormat = new Intl.NumberFormat("pt-BR");

function formatCount(value: number | null): string {
  return value === null ? "—" : numberFormat.format(value);
}

function mostRecentSyncedAt(items: TopSiteItem[]): string | null {
  if (items.length === 0) return null;
  return items.reduce((latest, item) => (item.synced_at > latest ? item.synced_at : latest), items[0].synced_at);
}

// ✅ 2026-08-09 (pedido do usuário): sem dado, o painel não renderiza nada
// (nunca uma mensagem de "vazio") — este widget sempre aparece ao lado de
// X Themes dentro de "Conteúdo em destaque", que já cobre o caso de "nada
// sincronizado ainda" com sua própria explicação; duas mensagens de vazio
// lado a lado eram redundantes.
export function TopSitesPanel({ items, timezone }: { items: TopSiteItem[]; timezone: string }) {
  if (items.length === 0) {
    return null;
  }

  const syncedAt = mostRecentSyncedAt(items);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-text-primary">Top Sites</h3>
        {syncedAt && <span className="text-xs text-text-tertiary">Atualizado {formatRelativeDate(syncedAt, timezone).toLowerCase()}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-xs font-bold uppercase tracking-wide text-text-primary">
              <th className="py-2 pr-4 font-bold">Domínio</th>
              <th className="px-4 py-2 text-right font-bold">Menções</th>
              <th className="px-4 py-2 text-right font-bold">Alcance</th>
              <th className="px-4 py-2 text-right font-bold">Visitantes/mês</th>
              <th className="px-4 py-2 font-bold">Sentimento</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const total = Math.max(1, (item.sentiment_positive ?? 0) + (item.sentiment_neutral ?? 0) + (item.sentiment_negative ?? 0));
              const hasSentiment = item.sentiment_positive !== null || item.sentiment_neutral !== null || item.sentiment_negative !== null;
              return (
                <tr key={item.domain} className="border-b border-border-subtle-2 last:border-0">
                  <td className="max-w-[220px] truncate py-2 pr-4 font-medium text-text-primary">{item.domain}</td>
                  <td className="px-4 py-2 text-right text-text-secondary">{formatCount(item.volume)}</td>
                  <td className="px-4 py-2 text-right text-text-secondary">{formatCount(item.reach_estimate)}</td>
                  <td className="px-4 py-2 text-right text-text-secondary">{formatCount(item.monthly_visitors)}</td>
                  <td className="px-4 py-2">
                    {hasSentiment ? (
                      <div
                        className="flex h-3 w-24 overflow-hidden rounded"
                        title={`Positivo ${item.sentiment_positive ?? 0} · Neutro ${item.sentiment_neutral ?? 0} · Negativo ${item.sentiment_negative ?? 0}`}
                      >
                        <div className="h-full bg-sentiment-positive" style={{ width: `${((item.sentiment_positive ?? 0) / total) * 100}%` }} />
                        <div className="h-full bg-sentiment-neutral" style={{ width: `${((item.sentiment_neutral ?? 0) / total) * 100}%` }} />
                        <div className="h-full bg-sentiment-negative" style={{ width: `${((item.sentiment_negative ?? 0) / total) * 100}%` }} />
                      </div>
                    ) : (
                      <span className="text-xs text-text-tertiary">sem dado</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
