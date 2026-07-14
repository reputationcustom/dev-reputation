export type FinopsCostRecurrence = "one_time" | "monthly" | "annual";

export type FinopsUsageSource = "event_radar_agent_orchestrator" | "ai_synthesis_narrative";

export interface FinopsManualCost {
  id: string;
  description: string;
  amount_usd: number;
  recurrence: FinopsCostRecurrence;
  effective_date: string;
  end_date: string | null;
}

export interface FinopsUsageBySource {
  source: FinopsUsageSource;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  call_count: number;
}

export interface FinopsDailyTrendPoint {
  date: string;
  cost_usd: number;
}

// get_finops_overview (.dev/specs/finops/data-model.md) — todo valor
// monetário em USD (o que a Anthropic cobra), nunca convertido pra outra
// moeda no backend.
export interface FinopsOverview {
  today: { cost_usd: number; call_count: number };
  month_to_date: { cost_usd: number; by_source: FinopsUsageBySource[] };
  projection: {
    avg_daily_ai_cost_usd: number;
    projected_ai_cost_usd: number;
    manual_costs_this_month_usd: number;
    projected_total_month_usd: number;
    days_elapsed: number;
    days_in_month: number;
  };
  daily_trend: FinopsDailyTrendPoint[];
  manual_costs: FinopsManualCost[];
}

export const FINOPS_SOURCE_LABELS: Record<FinopsUsageSource, string> = {
  event_radar_agent_orchestrator: "Radar de Eventos (IA)",
  ai_synthesis_narrative: "Síntese narrativa (IA)",
};

export const FINOPS_RECURRENCE_LABELS: Record<FinopsCostRecurrence, string> = {
  one_time: "Pontual",
  monthly: "Mensal",
  annual: "Anual",
};
