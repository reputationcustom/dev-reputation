import type { XInsightItem, XInsightType } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";
import { formatRelativeDate } from "@/lib/date/format";

// "X Themes" da Brandwatch — Top Hashtags/Most Mentioned X Posters/Top
// Stories/Top Emojis (bloco `x_insights`, só na página `/platforms`). Ver
// aggregated-metrics/sql-aggregation.md, get_x_insights, e
// foundation/data-model.md, bw_query_x_insights. Colunas espelham os
// rótulos da própria UI da Brandwatch: Posts = tweets, Reposts = retweets,
// All Posts = volume, Impressions = impressions.
const SECTION_META: Record<XInsightType, { title: string }> = {
  hashtag: { title: "Top Hashtags" },
  mentioned_author: { title: "Most Mentioned X Posters" },
  url: { title: "Top Stories" },
  emoticon: { title: "Top Emojis" },
};

const SECTION_ORDER: XInsightType[] = ["hashtag", "mentioned_author", "url", "emoticon"];

const numberFormat = new Intl.NumberFormat("pt-BR");

function formatCount(value: number | null): string {
  if (value === null) return "—";
  return numberFormat.format(value);
}

// Link clicável por tipo — pedido do usuário: "tudo que for possível
// colocar link clicável em X Themes... hashtags, perfis, url de posts,
// stories, etc." `XInsightItem.name` já é "a hashtag, emoji, URL ou
// @handle citado" (foundation/data-model.md, bw_query_x_insights) — cada
// tipo aponta pro X (Twitter), já que os 4 endpoints de origem
// ("X Insights") são específicos dessa rede. `emoticon` fica sem link —
// um emoji sozinho não é um recurso navegável, não existe URL real pra
// apontar (diferente dos outros 3 tipos, que sempre são).
function insightHref(type: XInsightType, name: string): string | null {
  if (type === "url") {
    // `name` já é a URL completa (Top Stories/Shared URLs) — só valida que
    // parece uma URL de verdade antes de linkar, pra nunca produzir um
    // href quebrado a partir de um dado inesperado.
    return /^https?:\/\//i.test(name) ? name : null;
  }
  if (type === "hashtag") {
    const tag = name.replace(/^#/, "").trim();
    return tag ? `https://x.com/hashtag/${encodeURIComponent(tag)}` : null;
  }
  if (type === "mentioned_author") {
    const handle = name.replace(/^@/, "").trim();
    return handle ? `https://x.com/${encodeURIComponent(handle)}` : null;
  }
  return null;
}

// bw-sync só re-sincroniza X Insights a cada 7 dias por par (project,
// query, category) — `isXInsightsStale` em bw-sync/index.ts. Um número
// sozinho ("Posts: 1.234") sem indicação de quando foi capturado é a causa
// mais provável de um usuário achar que "não bate" com o que vê ao vivo na
// Brandwatch: o dado pode estar correto, só desatualizado em até 7 dias.
// Todos os itens de uma seção vêm da mesma chamada/semana na prática, mas o
// máximo é usado por segurança caso um dia isso deixe de ser verdade.
function mostRecentSyncedAt(items: XInsightItem[]): string | null {
  if (items.length === 0) return null;
  return items.reduce((latest, item) => (item.synced_at > latest ? item.synced_at : latest), items[0].synced_at);
}

function InsightSection({
  type,
  items,
  timezone,
}: {
  type: XInsightType;
  items: XInsightItem[];
  timezone: string;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-text-primary">{SECTION_META[type].title}</h3>
        <EmptyState message="Nenhum dado de X sincronizado ainda para este escopo." />
      </div>
    );
  }

  const syncedAt = mostRecentSyncedAt(items);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-text-primary">{SECTION_META[type].title}</h3>
        {syncedAt && (
          <span className="text-xs text-text-tertiary">Atualizado {formatRelativeDate(syncedAt, timezone).toLowerCase()}</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-text-primary">
              <th className="py-2 pr-4 font-bold"></th>
              <th className="px-4 py-2 text-right font-bold">Posts</th>
              <th className="px-4 py-2 text-right font-bold">Reposts</th>
              <th className="px-4 py-2 text-right font-bold">All Posts</th>
              <th className="px-4 py-2 text-right font-bold">Impressions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const href = insightHref(type, item.name);
              return (
                <tr key={`${type}-${item.name}`} className="border-b border-border-subtle-2 last:border-0">
                  <td className="max-w-[220px] truncate py-2 pr-4">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-blue underline-offset-2 hover:underline"
                        title={href}
                      >
                        {item.name}
                      </a>
                    ) : (
                      <span className="text-accent-blue">{item.name}</span>
                    )}
                    {type === "emoticon" && item.label && (
                      <span className="ml-2 text-xs text-text-tertiary">{item.label}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-text-secondary">{formatCount(item.tweets)}</td>
                  <td className="px-4 py-2 text-right text-text-secondary">{formatCount(item.retweets)}</td>
                  <td className="px-4 py-2 text-right text-text-secondary">{formatCount(item.volume)}</td>
                  <td className="px-4 py-2 text-right text-text-secondary">{formatCount(item.impressions)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function XInsightsPanel({ items, timezone }: { items: XInsightItem[]; timezone: string }) {
  if (items.length === 0) {
    return <EmptyState message="Nenhum dado de X (Twitter) sincronizado ainda para este escopo — só disponível para Narrativas/Queries com presença relevante em X." />;
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {SECTION_ORDER.map((type) => (
        <InsightSection
          key={type}
          type={type}
          items={items.filter((item) => item.insight_type === type)}
          timezone={timezone}
        />
      ))}
    </div>
  );
}
