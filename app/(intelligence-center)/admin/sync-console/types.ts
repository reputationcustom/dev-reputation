// Mesma lista/ordem de supabase/functions/bw-sync/index.ts (SYNC_STEPS) —
// duplicada aqui (o frontend não pode importar de uma Edge Function,
// Princípio técnico 5) e também devolvida por get-sync-console-status
// (syncSteps) só como referência — este array é a fonte usada de fato pelo
// <select> do modal de execução manual.
export const SYNC_STEPS = [
  "metadata",
  "mentions",
  "daily_metrics",
  "hourly_metrics",
  "weekly_monthly",
  "topics",
  "platform_by_narrative",
  "x_insights",
  "top_authors",
  "top_tweeters",
  "author_enrichment",
  "top_sites",
  "top_shared_sites",
  "demographics",
  "full_text_enrichment",
  "sov",
] as const;

export type SyncStep = (typeof SYNC_STEPS)[number];

export const SYNC_STEP_LABELS: Record<SyncStep, string> = {
  metadata: "Metadados (Categorias/Subcategorias)",
  mentions: "Menções",
  daily_metrics: "Métricas diárias",
  hourly_metrics: "Métricas horárias",
  weekly_monthly: "Métricas semanais/mensais",
  topics: "Tópicos",
  platform_by_narrative: "Plataforma por Narrativa",
  x_insights: "X Themes (hashtags, posts, perfis)",
  top_authors: "Top Autores",
  top_tweeters: "Top Autores do X",
  author_enrichment: "Enriquecimento de autores",
  top_sites: "Top Sites",
  top_shared_sites: "Top Sites Compartilhados",
  demographics: "Demografia",
  full_text_enrichment: "Texto completo das menções",
  sov: "Share of Voice",
};

// Descrição curta de cada fase — usada no modal de execução manual e no
// accordion "Lista de referência das 16 fases" (pipeline-monitoring.md).
// Mesmo conteúdo em espírito de foundation/sync-brandwatch.md, "Execução
// em fases", só compactado pra consulta rápida nesta tela.
export const SYNC_STEP_DESCRIPTIONS: Record<SyncStep, string> = {
  metadata: "Sincroniza Categorias e Subcategorias configuradas na Brandwatch — o que vira Narrativas no produto.",
  mentions: "Busca as publicações individuais (posts, tweets, notícias) capturadas pela Brandwatch.",
  daily_metrics: "Volume, sentimento, alcance e engajamento por dia, por Narrativa e da Query inteira.",
  hourly_metrics: "Volume e sentimento por hora (últimos 30 dias) — alimenta gráficos de curto prazo/Diário.",
  weekly_monthly: "Volume e sentimento agregados por semana e por mês.",
  topics: "Termos, hashtags e frases mais citados.",
  platform_by_narrative: "Participação de cada plataforma dentro de cada Narrativa.",
  x_insights: "Hashtags, emojis, publicações e perfis mais citados no X (Twitter).",
  top_authors: "Ranking de autores por volume de menções, entre todas as plataformas.",
  top_tweeters: "Ranking de autores especificamente no X (Twitter).",
  author_enrichment: "Sentimento e temas associados aos autores mais relevantes.",
  top_sites: "Domínios de onde as menções mais se originam.",
  top_shared_sites: "Domínios mais compartilhados dentro do conteúdo das menções.",
  demographics: "Perfil demográfico (gênero, localização, interesses) de quem publica.",
  full_text_enrichment: "Busca o texto completo de menções relevantes ainda não capturadas por inteiro.",
  sov: "Comparação de volume entre Queries de um mesmo grupo (Share of Voice).",
};

export const STOP_REASON_LABELS: Record<string, string> = {
  cycle_complete: "Ciclo completo",
  stay_on_step: "Aguardando (continua nesta fase)",
  call_budget_exhausted: "Limite de chamadas atingido",
  time_budget_exhausted: "Tempo de execução esgotado",
};

export interface SyncConsolePair {
  projectId: number;
  queryId: number;
  projectName: string | null;
  queryName: string | null;
  currentStep: string;
  lastSyncedAt: string | null;
  nextDueAt: string | null;
  dueNow: boolean;
  status: string;
  lastError: string | null;
}

export interface SyncConsoleGlobalState {
  locked: boolean;
  lockedUntil: string | null;
  rateLimited: boolean;
  rateLimitedUntil: string | null;
  lastRateLimitUsed: number | null;
  lastRateLimitObservedAt: string | null;
}

export interface SyncConsoleStatus {
  pairs: SyncConsolePair[];
  globalState: SyncConsoleGlobalState;
  syncIntervalHours: number;
  syncSteps: SyncStep[];
}

export interface SyncConsoleHistoryItem {
  id: string;
  projectId: number;
  queryId: number;
  projectName: string | null;
  queryName: string | null;
  step: string | null;
  status: string;
  rowsProcessed: number;
  durationMs: number | null;
  stopReason: string | null;
  triggerSource: string;
  triggeredByUserName: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface SyncConsoleHistoryResponse {
  items: SyncConsoleHistoryItem[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface TriggerSyncStepResult {
  ok: boolean;
  step?: string;
  didWork?: boolean;
  recordsSynced?: number;
  durationMs?: number;
  error?: string;
}
