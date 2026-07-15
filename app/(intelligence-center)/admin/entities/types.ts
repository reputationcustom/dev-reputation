// Tipos do Cadastro Nacional de Entidades (.dev/specs/entities/data-model.md).
// Espelha o schema real (entities.cargo/partido/ideologia — não `description`,
// renomeada/expandida pela migration 20260731050000).

export type EntityType = "person" | "media_outlet" | "party" | "institution" | "company" | "movement" | "other";

export type InfluenceLevel = "low" | "medium" | "high" | "critical";

export const ENTITY_TYPE_OPTIONS: { value: EntityType; label: string }[] = [
  { value: "person", label: "Pessoa" },
  { value: "media_outlet", label: "Veículo de Imprensa" },
  { value: "party", label: "Partido" },
  { value: "institution", label: "Instituição" },
  { value: "company", label: "Empresa" },
  { value: "movement", label: "Movimento" },
  { value: "other", label: "Outro" },
];

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = Object.fromEntries(
  ENTITY_TYPE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<EntityType, string>;

// Vocabulário em uso até aqui (data-model.md) — texto livre no banco, não
// enum, então o formulário sempre aceita "Outra..." além destas 5.
export const IDEOLOGIA_OPTIONS = ["esquerda", "centro-esquerda", "centro", "centro-direita", "direita"] as const;

export const IDEOLOGIA_LABEL: Record<string, string> = {
  esquerda: "Esquerda",
  "centro-esquerda": "Centro-esquerda",
  centro: "Centro",
  "centro-direita": "Centro-direita",
  direita: "Direita",
};

// Rótulo próprio pra influence_level (entity-registration.md, "Interface") —
// mesmo valor de banco de severity_level (risk_label de Narrativa), semântica
// de exibição diferente ("Baixa/Média/Alta/Muito alta", não
// "Baixo/Médio/Alto/Crítico" — não confundir influência com risco).
export const INFLUENCE_LEVEL_OPTIONS: { value: InfluenceLevel; label: string }[] = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "critical", label: "Muito alta" },
];

export const INFLUENCE_LEVEL_LABEL: Record<InfluenceLevel, string> = Object.fromEntries(
  INFLUENCE_LEVEL_OPTIONS.map((option) => [option.value, option.label]),
) as Record<InfluenceLevel, string>;

// Vocabulário sugerido de tag_type (data-model.md) — informativo, qualquer
// valor novo é aceito (EAV extensível por design).
export const TAG_TYPE_SUGGESTIONS = ["power_branch", "state", "stance_to_candidate", "segment", "website"];

export const PLATFORM_SUGGESTIONS = [
  "twitter",
  "instagram",
  "facebook",
  "tiktok",
  "reddit",
  "linkedin",
  "news",
  "blog",
];

export interface EntityAccount {
  id: string;
  platform: string;
  username: string;
  url: string | null;
}

export interface EntityTag {
  id: string;
  tag_type: string;
  tag_value: string;
}

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  cargo: string | null;
  partido: string | null;
  ideologia: string | null;
  photo_url: string | null;
  influence_level: InfluenceLevel | null;
  is_active: boolean;
  accounts: EntityAccount[];
  tags: EntityTag[];
}

// Corpo enviado a create-entity/update-entity — linhas de conta/classificação
// sem id (identidade não importa entre edições, ver entity-registration.md
// "Fluxo principal" item 6: substituição completa, nunca diff).
export interface EntityAccountInput {
  platform: string;
  username: string;
  url: string;
}

export interface EntityTagInput {
  tag_type: string;
  tag_value: string;
}

export interface EntityFormValues {
  type: EntityType;
  name: string;
  cargo: string;
  partido: string;
  ideologia: string;
  photo_url: string;
  influence_level: InfluenceLevel | "";
  accounts: EntityAccountInput[];
  tags: EntityTagInput[];
}
