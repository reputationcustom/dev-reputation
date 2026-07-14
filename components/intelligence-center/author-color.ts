import type { AuthorRow } from "@reputation/shared-types";

// Cor/rótulo compartilhados entre AuthorsList, o gráfico de dispersão, os
// breakdowns por ideologia/partido e o painel de detalhe (Autores e
// Influenciadores, .dev/specs/intelligence-center/authors-and-influencers.md,
// "Redesenho interativo"). Um lugar só evita 4 implementações divergentes
// da mesma regra de cor.

export const IDEOLOGY_ORDER = ["esquerda", "centro-esquerda", "centro", "centro-direita", "direita"] as const;
export type Ideology = (typeof IDEOLOGY_ORDER)[number];

export const IDEOLOGY_LABEL: Record<Ideology, string> = {
  esquerda: "Esquerda",
  "centro-esquerda": "Centro-esquerda",
  centro: "Centro",
  "centro-direita": "Centro-direita",
  direita: "Direita",
};

// Classes Tailwind (.dev/specs/_design-tokens.md, "Ideologia") — conjunto
// fixo e pequeno, mesmo padrão de SENTIMENT_META/RISK_META em
// score-badges.tsx (nunca um template string dinâmico de classe, pra não
// depender do Tailwind adivinhar uma classe gerada em runtime).
export const IDEOLOGY_BADGE_CLASS: Record<Ideology, { bg: string; text: string }> = {
  esquerda: { bg: "bg-ideology-left-bg", text: "text-ideology-left" },
  "centro-esquerda": { bg: "bg-ideology-center-left-bg", text: "text-ideology-center-left" },
  centro: { bg: "bg-ideology-center-bg", text: "text-ideology-center" },
  "centro-direita": { bg: "bg-ideology-center-right-bg", text: "text-ideology-center-right" },
  direita: { bg: "bg-ideology-right-bg", text: "text-ideology-right" },
};

// Hex sólido (não o par bg-claro/texto-escuro acima) — usado onde a cor
// precisa ser um fill/stroke de SVG ou um fundo com texto branco (pontos
// da dispersão, avatar circular, barras de breakdown), nunca uma classe
// Tailwind dinâmica.
export const IDEOLOGY_HEX: Record<Ideology, string> = {
  esquerda: "#6d28d9",
  "centro-esquerda": "#a78bda",
  centro: "#8a8f98",
  "centro-direita": "#5fb8ba",
  direita: "#0d9488",
};

function isIdeology(value: string | null): value is Ideology {
  return value !== null && (IDEOLOGY_ORDER as readonly string[]).includes(value);
}

export function ideologyLabel(value: string | null): string | null {
  return isIdeology(value) ? IDEOLOGY_LABEL[value] : value;
}

export function ideologyBadgeClass(value: string | null): { bg: string; text: string } | null {
  return isIdeology(value) ? IDEOLOGY_BADGE_CLASS[value] : null;
}

export function ideologyHex(value: string | null): string | null {
  return isIdeology(value) ? IDEOLOGY_HEX[value] : null;
}

// Paleta categórica de fallback pra partido (nomes não são conhecidos de
// antemão) — hash determinístico, mesmo mecanismo/mesma paleta já usados
// por trend-line-chart.tsx pra grupos dinâmicos (page_type/título de
// Pauta) sem cor fixa conhecida.
const PARTY_FALLBACK_PALETTE = ["#2f6fed", "#1a9d5c", "#e0483e", "#f5a623", "#9b59b6", "#17a2b8", "#8a8f98", "#d4478e"];

function hashKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash;
}

export function partidoColor(partido: string | null): string | null {
  if (!partido) return null;
  return PARTY_FALLBACK_PALETTE[hashKey(partido) % PARTY_FALLBACK_PALETTE.length];
}

// Sentimento dominante do autor (positivo/neutro/negativo) — null quando os
// 3 campos não vêm preenchidos (fora do recorte de top autores enriquecido,
// ver AuthorRow.sentiment_*), nunca inventa um valor "neutro" pra esse caso.
export type DominantSentiment = "positive" | "neutral" | "negative";

export function dominantSentiment(author: Pick<AuthorRow, "sentiment_positive" | "sentiment_neutral" | "sentiment_negative">): DominantSentiment | null {
  const { sentiment_positive, sentiment_neutral, sentiment_negative } = author;
  if (sentiment_positive === null || sentiment_neutral === null || sentiment_negative === null) return null;
  if (sentiment_positive === 0 && sentiment_neutral === 0 && sentiment_negative === 0) return null;
  if (sentiment_positive >= sentiment_neutral && sentiment_positive >= sentiment_negative) return "positive";
  if (sentiment_negative >= sentiment_neutral && sentiment_negative >= sentiment_positive) return "negative";
  return "neutral";
}

export const SENTIMENT_HEX: Record<DominantSentiment, string> = {
  positive: "#1a9d5c",
  neutral: "#8a8f98",
  negative: "#e0483e",
};

export const SENTIMENT_LABEL: Record<DominantSentiment, string> = {
  positive: "Positivo",
  neutral: "Neutro",
  negative: "Negativo",
};

// Tipo de Entidade (entities.type — CLAUDE.md/entities/data-model.md) — usado
// pela guia "Por Entidade" (redesenho em 2 guias, 2026-08-08) pra generalizar
// além de partido: pessoa, partido, veículo de imprensa, instituição,
// empresa, movimento, outro. Ordem fixa (não por valor) — mesma convenção de
// IDEOLOGY_ORDER, pra a leitura não pular de posição entre recargas.
export const ENTITY_TYPE_ORDER = ["person", "party", "media_outlet", "institution", "company", "movement", "other"] as const;
export type EntityType = (typeof ENTITY_TYPE_ORDER)[number];

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  person: "Pessoa",
  party: "Partido",
  media_outlet: "Veículo de Imprensa",
  institution: "Instituição",
  company: "Empresa",
  movement: "Movimento",
  other: "Outro",
};

// Paleta fixa (não hash-based, diferente de partido) — só 7 valores
// conhecidos de antemão (o enum Postgres entity_type), então uma legenda com
// itens fixos é possível e mais clara que uma paleta aberta.
export const ENTITY_TYPE_HEX: Record<EntityType, string> = {
  person: "#2f6fed",
  party: "#9b59b6",
  media_outlet: "#f5a623",
  institution: "#17a2b8",
  company: "#d4478e",
  movement: "#6d4c41",
  other: "#8a8f98",
};

function isEntityType(value: string | null): value is EntityType {
  return value !== null && (ENTITY_TYPE_ORDER as readonly string[]).includes(value);
}

export function entityTypeLabel(value: string | null): string | null {
  return isEntityType(value) ? ENTITY_TYPE_LABEL[value] : value;
}

export function entityTypeHex(value: string | null): string | null {
  return isEntityType(value) ? ENTITY_TYPE_HEX[value] : null;
}

// Dimensão ativa no controle "Colorir por" (toolbar da página /authors) —
// controla a cor do avatar/dot em AuthorsList, na dispersão e no painel de
// detalhe ao mesmo tempo. "entity_type" só faz sentido na guia "Por
// Entidade" (redesenho em 2 guias, 2026-08-08).
export type ColorByMode = "ideologia" | "partido" | "sentimento" | "entity_type";

export const MUTED_HEX = "#c9cdd3"; // mesmo neutral-gray de _design-tokens.md

// Cor sólida (hex) do autor pra uma dimensão — autor sem Entity vinculada
// (a maioria hoje) sempre cai no cinza neutro, nunca escondido/penalizado
// (ver authors-and-influencers.md, "Regras de negócio").
export function authorColorHex(author: AuthorRow, mode: ColorByMode): string {
  if (mode === "partido") return (author.entity_partido && partidoColor(author.entity_partido)) || MUTED_HEX;
  if (mode === "sentimento") {
    const s = dominantSentiment(author);
    return s ? SENTIMENT_HEX[s] : MUTED_HEX;
  }
  if (mode === "entity_type") return (author.entity_type && entityTypeHex(author.entity_type)) || MUTED_HEX;
  return (author.entity_ideologia && ideologyHex(author.entity_ideologia)) || MUTED_HEX;
}

// Rótulo curto pra exibir sob o nome do autor quando não há `entity_cargo`
// (pessoas) — usa o `tag_value` de `segment` (media_outlet/company, ver
// entities/data-model.md, seed de institutos/veículos 2026-07-14) como
// aproximação de "o que essa Entity é/faz". Nunca inventa um valor — `null`
// quando a Entity não tem essa tag.
export function entitySegment(author: Pick<AuthorRow, "entity_tags">): string | null {
  return author.entity_tags.find((t) => t.tag_type === "segment")?.tag_value ?? null;
}

// "Papel na conversa" — widget "Quem move a conversa" (Formação e
// propagação, narratives-exploration.md). Combina o que já existe, sem
// nenhum cálculo novo de backend: quando o autor tem uma Entity vinculada
// de um tipo institucional (imprensa/instituição/partido), o papel é o
// próprio tipo — mais informativo que sentimento pra esses casos (um
// veículo de imprensa não é "crítico" ou "apoiador", é imprensa). Sem esse
// vínculo (a maioria dos autores, tipicamente pessoas físicas), o papel cai
// pro sentimento dominante já calculado (dominantSentiment) — mesma lógica
// já usada por Detratores/Impulsionadores positivos (dissemination-stance-lists.tsx).
// `null` (nunca um valor inventado) quando não há Entity institucional
// vinculada E não há dado de sentimento suficiente pra classificar.
export type AuthorRole = "imprensa" | "institucional" | "partidario" | "critico" | "apoiador" | "neutro";

const ENTITY_TYPE_ROLE: Partial<Record<EntityType, AuthorRole>> = {
  media_outlet: "imprensa",
  institution: "institucional",
  party: "partidario",
};

export const AUTHOR_ROLE_LABEL: Record<AuthorRole, string> = {
  imprensa: "Imprensa",
  institucional: "Institucional",
  partidario: "Partidário",
  critico: "Crítico",
  apoiador: "Apoiador",
  neutro: "Neutro",
};

export const AUTHOR_ROLE_HEX: Record<AuthorRole, string> = {
  imprensa: ENTITY_TYPE_HEX.media_outlet,
  institucional: ENTITY_TYPE_HEX.institution,
  partidario: ENTITY_TYPE_HEX.party,
  critico: SENTIMENT_HEX.negative,
  apoiador: SENTIMENT_HEX.positive,
  neutro: SENTIMENT_HEX.neutral,
};

export function authorRole(
  author: Pick<AuthorRow, "entity_type" | "sentiment_positive" | "sentiment_neutral" | "sentiment_negative">,
): AuthorRole | null {
  const entityRole = author.entity_type ? ENTITY_TYPE_ROLE[author.entity_type as EntityType] : undefined;
  if (entityRole) return entityRole;
  const sentiment = dominantSentiment(author);
  if (sentiment === "negative") return "critico";
  if (sentiment === "positive") return "apoiador";
  if (sentiment === "neutral") return "neutro";
  return null;
}

// Plataforma(s) do autor — `AuthorRow.platforms`, ver get_authors_ranking/
// bw_top_author_platform_tags (só reporta uma plataforma quando há sinal
// real no platform_stats já sincronizado, nunca fabricada). Mais de uma
// plataforma junta com " · ", mesmo separador visual já usado noutros
// lugares deste componente (ex: chips de narrativa).
export const PLATFORM_TAG_ORDER = ["twitter", "instagram", "facebook", "tiktok", "linkedin", "bluesky"] as const;
export type PlatformTag = (typeof PLATFORM_TAG_ORDER)[number];

export const PLATFORM_TAG_LABEL: Record<PlatformTag, string> = {
  twitter: "X / Twitter",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  bluesky: "Bluesky",
};

function isPlatformTag(value: string): value is PlatformTag {
  return (PLATFORM_TAG_ORDER as readonly string[]).includes(value);
}

export function formatPlatforms(platforms: string[]): string {
  const labels = platforms.filter(isPlatformTag).map((tag) => PLATFORM_TAG_LABEL[tag]);
  return labels.length > 0 ? labels.join(" · ") : "—";
}

export function authorInitials(name: string): string {
  const parts = name
    .replace(/[#0-9]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase();
}
