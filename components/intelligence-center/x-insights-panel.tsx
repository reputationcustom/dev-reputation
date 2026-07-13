import type { XInsightItem, XInsightType } from "@reputation/shared-types";
import { EmptyState } from "@/components/ui/empty-state";

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

function InsightSection({ type, items }: { type: XInsightType; items: XInsightItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-text-primary">{SECTION_META[type].title}</h3>
        <EmptyState message="Nenhum dado de X sincronizado ainda para este escopo." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-text-primary">{SECTION_META[type].title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-text-tertiary">
              <th className="py-2 pr-4 font-medium"></th>
              <th className="px-4 py-2 text-right font-medium">Posts</th>
              <th className="px-4 py-2 text-right font-medium">Reposts</th>
              <th className="px-4 py-2 text-right font-medium">All Posts</th>
              <th className="px-4 py-2 text-right font-medium">Impressions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${type}-${item.name}`} className="border-b border-border-subtle-2 last:border-0">
                <td className="py-2 pr-4 text-accent-blue">
                  {item.name}
                  {type === "emoticon" && item.label && (
                    <span className="ml-2 text-xs text-text-tertiary">{item.label}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right text-text-secondary">{formatCount(item.tweets)}</td>
                <td className="px-4 py-2 text-right text-text-secondary">{formatCount(item.retweets)}</td>
                <td className="px-4 py-2 text-right text-text-secondary">{formatCount(item.volume)}</td>
                <td className="px-4 py-2 text-right text-text-secondary">{formatCount(item.impressions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function XInsightsPanel({ items }: { items: XInsightItem[] }) {
  if (items.length === 0) {
    return <EmptyState message="Nenhum dado de X (Twitter) sincronizado ainda para este escopo — só disponível para Narrativas/Queries com presença relevante em X." />;
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {SECTION_ORDER.map((type) => (
        <InsightSection key={type} type={type} items={items.filter((item) => item.insight_type === type)} />
      ))}
    </div>
  );
}
