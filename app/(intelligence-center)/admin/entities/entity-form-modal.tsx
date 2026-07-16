"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import {
  ENTITY_TYPE_OPTIONS,
  IDEOLOGIA_LABEL,
  IDEOLOGIA_OPTIONS,
  INFLUENCE_LEVEL_OPTIONS,
  PLATFORM_SUGGESTIONS,
  TAG_TYPE_SUGGESTIONS,
  type Entity,
  type EntityAccountInput,
  type EntityFormValues,
  type EntityTagInput,
  type EntityType,
  type InfluenceLevel,
} from "./types";

const IDEOLOGIA_SELECT_VALUES = new Set<string>(IDEOLOGIA_OPTIONS);
const OUTRA_IDEOLOGIA = "__outra__";

function emptyAccount(): EntityAccountInput {
  return { platform: "", username: "", url: "" };
}

function emptyTag(): EntityTagInput {
  return { tag_type: "", tag_value: "" };
}

// Cadastro/edição de Entidade (.dev/specs/entities/entity-registration.md,
// "Fluxo principal" itens 4/6) — 3 seções: Dados básicos, Contas nas redes
// (repetível), Classificação adicional (repetível). Mesmo componente serve
// criação e edição, mesma convenção de ManualCostModal/InviteUserModal
// (não duplicar UI).
export function EntityFormModal({
  initial,
  knownParties,
  knownTagValuesByType,
  conflictAccount,
  onClose,
  onSubmit,
}: {
  initial?: Entity;
  // Sugestões vindas da listagem já carregada — nunca uma chamada nova só
  // pra popular um <datalist> (entity-registration.md, "Dados envolvidos").
  knownParties: string[];
  knownTagValuesByType: Record<string, string[]>;
  // Preenchido pelo chamador quando o submit anterior voltou 409 (handle
  // duplicado) — destaca a linha de conta responsável (entity-registration.md,
  // "Fluxos alternativos", erro inline na linha).
  conflictAccount?: { platform: string; username: string } | null;
  onClose: () => void;
  onSubmit: (values: EntityFormValues) => Promise<void>;
}) {
  const [type, setType] = useState<EntityType>(initial?.type ?? "person");
  const [name, setName] = useState(initial?.name ?? "");
  const [cargo, setCargo] = useState(initial?.cargo ?? "");
  const [partido, setPartido] = useState(initial?.partido ?? "");
  const initialIdeologia = initial?.ideologia ?? "";
  const [ideologiaSelect, setIdeologiaSelect] = useState(
    initialIdeologia && !IDEOLOGIA_SELECT_VALUES.has(initialIdeologia) ? OUTRA_IDEOLOGIA : initialIdeologia,
  );
  const [ideologiaCustom, setIdeologiaCustom] = useState(
    initialIdeologia && !IDEOLOGIA_SELECT_VALUES.has(initialIdeologia) ? initialIdeologia : "",
  );
  const [photoUrl, setPhotoUrl] = useState(initial?.photo_url ?? "");
  const [influenceLevel, setInfluenceLevel] = useState<InfluenceLevel | "">(initial?.influence_level ?? "");

  const [accounts, setAccounts] = useState<EntityAccountInput[]>(
    initial?.accounts.map((a) => ({ platform: a.platform, username: a.username, url: a.url ?? "" })) ?? [],
  );
  const [tags, setTags] = useState<EntityTagInput[]>(
    initial?.tags.map((t) => ({ tag_type: t.tag_type, tag_value: t.tag_value })) ?? [],
  );

  const [nameError, setNameError] = useState<string | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isParty = type === "party";

  function updateAccount(index: number, patch: Partial<EntityAccountInput>) {
    setAccounts((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function updateTag(index: number, patch: Partial<EntityTagInput>) {
    setTags((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function isIncompleteAccountRow(row: EntityAccountInput) {
    const platform = row.platform.trim();
    const username = row.username.trim();
    return (platform && !username) || (!platform && username);
  }

  function isIncompleteTagRow(row: EntityTagInput) {
    const tagType = row.tag_type.trim();
    const tagValue = row.tag_value.trim();
    return (tagType && !tagValue) || (!tagType && tagValue);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setNameError(null);
    setAccountsError(null);
    setTagsError(null);
    setFormError(null);

    let hasError = false;
    if (!name.trim()) {
      setNameError("Informe um nome");
      hasError = true;
    }
    if (accounts.some(isIncompleteAccountRow)) {
      setAccountsError("Preencha plataforma e usuário, ou remova esta linha");
      hasError = true;
    }
    if (tags.some(isIncompleteTagRow)) {
      setTagsError("Preencha a dimensão e o valor, ou remova esta linha");
      hasError = true;
    }
    if (hasError) return;

    const ideologia = ideologiaSelect === OUTRA_IDEOLOGIA ? ideologiaCustom.trim() : ideologiaSelect;

    setLoading(true);
    try {
      await onSubmit({
        type,
        name: name.trim(),
        cargo: isParty ? "" : cargo.trim(),
        partido: isParty ? "" : partido.trim(),
        ideologia,
        photo_url: photoUrl.trim(),
        influence_level: influenceLevel,
        accounts: accounts.filter((row) => row.platform.trim() && row.username.trim()),
        tags: tags.filter((row) => row.tag_type.trim() && row.tag_value.trim()),
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Algo deu errado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={initial ? "Editar Entidade" : "Nova Entidade"} onClose={onClose} maxWidthClassName="max-w-2xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {formError && (
          <p className="rounded-md bg-[#fdecea] px-3 py-2 text-sm text-[#a52820]" role="alert">
            {formError}
          </p>
        )}

        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-bold text-text-primary">Dados básicos</h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="entity-type" className="text-sm font-medium text-text-primary">
                Tipo
              </label>
              <select
                id="entity-type"
                value={type}
                onChange={(event) => setType(event.target.value as EntityType)}
                disabled={loading}
                className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
              >
                {ENTITY_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="entity-name" className="text-sm font-medium text-text-primary">
                Nome
              </label>
              <input
                id="entity-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={loading}
                placeholder="Ex: João da Silva, Rede Globo, PT"
                className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
              />
              {nameError && <p className="text-xs text-[#e0483e]">{nameError}</p>}
            </div>
          </div>

          {!isParty && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="entity-cargo" className="text-sm font-medium text-text-primary">
                  Cargo <span className="font-normal text-text-tertiary">(opcional)</span>
                </label>
                <input
                  id="entity-cargo"
                  type="text"
                  value={cargo}
                  onChange={(event) => setCargo(event.target.value)}
                  disabled={loading}
                  placeholder="Ex: Deputado Federal, Colunista"
                  className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="entity-partido" className="text-sm font-medium text-text-primary">
                  Partido <span className="font-normal text-text-tertiary">(opcional)</span>
                </label>
                <input
                  id="entity-partido"
                  type="text"
                  list="entity-known-parties"
                  value={partido}
                  onChange={(event) => setPartido(event.target.value)}
                  disabled={loading}
                  placeholder="Ex: PT, PL, MDB"
                  className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
                />
                <datalist id="entity-known-parties">
                  {knownParties.map((party) => (
                    <option key={party} value={party} />
                  ))}
                </datalist>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="entity-ideologia" className="text-sm font-medium text-text-primary">
                Ideologia <span className="font-normal text-text-tertiary">(opcional)</span>
              </label>
              <select
                id="entity-ideologia"
                value={ideologiaSelect}
                onChange={(event) => setIdeologiaSelect(event.target.value)}
                disabled={loading}
                className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
              >
                <option value="">—</option>
                {IDEOLOGIA_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {IDEOLOGIA_LABEL[value]}
                  </option>
                ))}
                <option value={OUTRA_IDEOLOGIA}>Outra...</option>
              </select>
              {ideologiaSelect === OUTRA_IDEOLOGIA && (
                <input
                  type="text"
                  value={ideologiaCustom}
                  onChange={(event) => setIdeologiaCustom(event.target.value)}
                  disabled={loading}
                  placeholder="Informe a classificação"
                  className="mt-1 rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
                />
              )}
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="entity-influence" className="text-sm font-medium text-text-primary">
                Nível de influência <span className="font-normal text-text-tertiary">(opcional)</span>
              </label>
              <select
                id="entity-influence"
                value={influenceLevel}
                onChange={(event) => setInfluenceLevel(event.target.value as InfluenceLevel | "")}
                disabled={loading}
                className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
              >
                <option value="">—</option>
                {INFLUENCE_LEVEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="entity-photo" className="text-sm font-medium text-text-primary">
              URL da foto <span className="font-normal text-text-tertiary">(opcional)</span>
            </label>
            <input
              id="entity-photo"
              type="text"
              value={photoUrl}
              onChange={(event) => setPhotoUrl(event.target.value)}
              disabled={loading}
              placeholder="https://..."
              className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
            />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-text-primary">Contas nas redes</h3>
            <button
              type="button"
              onClick={() => setAccounts((current) => [...current, emptyAccount()])}
              disabled={loading}
              className="text-sm font-medium text-accent-blue hover:underline disabled:opacity-60"
            >
              + Adicionar conta
            </button>
          </div>

          {accounts.length === 0 && <p className="text-sm text-text-tertiary">Nenhuma conta informada.</p>}

          {accounts.map((row, index) => {
            const isConflict =
              conflictAccount &&
              row.platform.trim().toLowerCase() === conflictAccount.platform.trim().toLowerCase() &&
              row.username.trim().toLowerCase() === conflictAccount.username.trim().toLowerCase();
            return (
              <div key={index} className="flex flex-col gap-1">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    list="entity-platform-suggestions"
                    value={row.platform}
                    onChange={(event) => updateAccount(index, { platform: event.target.value })}
                    disabled={loading}
                    placeholder="Plataforma (ex: twitter)"
                    className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60 sm:w-40 ${
                      isConflict ? "border-[#e0483e]" : "border-border-default"
                    }`}
                  />
                  <input
                    type="text"
                    value={row.username}
                    onChange={(event) => updateAccount(index, { username: event.target.value })}
                    disabled={loading}
                    placeholder="Usuário/handle"
                    className={`w-full flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60 ${
                      isConflict ? "border-[#e0483e]" : "border-border-default"
                    }`}
                  />
                  <input
                    type="text"
                    value={row.url}
                    onChange={(event) => updateAccount(index, { url: event.target.value })}
                    disabled={loading}
                    placeholder="URL do perfil (opcional)"
                    className="w-full flex-1 rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setAccounts((current) => current.filter((_, i) => i !== index))}
                    disabled={loading}
                    aria-label="Remover conta"
                    className="self-start rounded-md px-2 py-2 text-text-tertiary hover:bg-bg-page hover:text-[#e0483e] disabled:opacity-60"
                  >
                    ✕
                  </button>
                </div>
                {isConflict && (
                  <p className="text-xs text-[#e0483e]">
                    Este usuário já está cadastrado em outra Entidade nesta plataforma.
                  </p>
                )}
              </div>
            );
          })}
          <datalist id="entity-platform-suggestions">
            {PLATFORM_SUGGESTIONS.map((platform) => (
              <option key={platform} value={platform} />
            ))}
          </datalist>
          {accountsError && <p className="text-xs text-[#e0483e]">{accountsError}</p>}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-text-primary">Classificação adicional</h3>
            <button
              type="button"
              onClick={() => setTags((current) => [...current, emptyTag()])}
              disabled={loading}
              className="text-sm font-medium text-accent-blue hover:underline disabled:opacity-60"
            >
              + Adicionar classificação
            </button>
          </div>

          {tags.length === 0 && <p className="text-sm text-text-tertiary">Nenhuma classificação informada.</p>}

          {tags.map((row, index) => (
            <div key={index} className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                list="entity-tag-type-suggestions"
                value={row.tag_type}
                onChange={(event) => updateTag(index, { tag_type: event.target.value })}
                disabled={loading}
                placeholder="Dimensão (ex: power_branch, state)"
                className="w-full rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60 sm:w-56"
              />
              <input
                type="text"
                list={`entity-tag-value-suggestions-${row.tag_type.trim() || "default"}`}
                value={row.tag_value}
                onChange={(event) => updateTag(index, { tag_value: event.target.value })}
                disabled={loading}
                placeholder="Valor"
                className="w-full flex-1 rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setTags((current) => current.filter((_, i) => i !== index))}
                disabled={loading}
                aria-label="Remover classificação"
                className="self-start rounded-md px-2 py-2 text-text-tertiary hover:bg-bg-page hover:text-[#e0483e] disabled:opacity-60"
              >
                ✕
              </button>
            </div>
          ))}
          <datalist id="entity-tag-type-suggestions">
            {TAG_TYPE_SUGGESTIONS.map((tagType) => (
              <option key={tagType} value={tagType} />
            ))}
          </datalist>
          {Object.entries(knownTagValuesByType).map(([tagType, values]) => (
            <datalist key={tagType} id={`entity-tag-value-suggestions-${tagType}`}>
              {values.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          ))}
          <datalist id="entity-tag-value-suggestions-default" />
          {tagsError && <p className="text-xs text-[#e0483e]">{tagsError}</p>}
        </section>

        <div className="flex justify-end gap-3 border-t border-border-subtle pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-md border border-border-default px-4 py-2 text-sm font-medium text-text-primary hover:bg-bg-page disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {loading && <Spinner className="h-4 w-4 text-white" />}
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
}
