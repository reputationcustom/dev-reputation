"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { NarrativeCombobox } from "@/components/communications/narrative-combobox";
import type { NarrativeOption } from "@/hooks/use-narratives-list";
import type { CommunicationTypeOption } from "@/hooks/use-communication-types";
import type { OrganizationMemberOption } from "@/hooks/use-organization-members";
import type { CommunicationRecordType, CommunicationRow } from "@/components/communications/types";

export interface CommunicationFormValues {
  narrative_id: string;
  record_type: CommunicationRecordType;
  title: string;
  description: string | null;
  occurred_at: string;
  assignee_id: string | null;
  communication_type_id: string | null;
  channel_detail: string | null;
  external_url: string | null;
  bw_resource_id: string | null;
}

// yyyy-MM-ddTHH:mm, no fuso local do navegador — simplificação deliberada
// (o resto do produto formata data de EXIBIÇÃO sempre no fuso do usuário
// configurado, via useUserProfile/date-fns-tz; um <input type="datetime-local">
// já opera no fuso local do navegador nativamente, e os dois coincidem na
// prática — não vale o custo de plumbing extra pra um campo de formulário).
function toDatetimeLocalValue(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Formulário de cadastro/edição de Comunicações e Decisões
// (communications/communication-registration.md) — um único componente
// reaproveitado nas 4 entradas do produto (lista geral, detalhe completo de
// Narrativa, modal rápido de Narrativa, linha do tempo de impacto), pedido
// explícito do usuário ("facilitar ao máximo"). `lockedNarrative` (quando
// presente) substitui o `NarrativeCombobox` por um rótulo fixo — ver
// "Entrada rápida a partir de uma Narrativa" na spec.
export function CommunicationFormModal({
  narratives,
  communicationTypes,
  members,
  lockedNarrative,
  editing,
  onClose,
  onSubmit,
}: {
  narratives: NarrativeOption[];
  communicationTypes: CommunicationTypeOption[];
  members: OrganizationMemberOption[];
  lockedNarrative?: { id: string; title: string };
  editing?: CommunicationRow | null;
  onClose: () => void;
  onSubmit: (values: CommunicationFormValues) => Promise<void>;
}) {
  const isEditing = !!editing;
  const [recordType, setRecordType] = useState<CommunicationRecordType>(editing?.record_type ?? "communication");
  const [narrativeId, setNarrativeId] = useState(lockedNarrative?.id ?? editing?.narrative_id ?? "");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [occurredAt, setOccurredAt] = useState(
    editing ? toDatetimeLocalValue(editing.occurred_at) : toDatetimeLocalValue(new Date().toISOString()),
  );
  const [assigneeId, setAssigneeId] = useState(editing?.assignee_id ?? "");
  const [communicationTypeId, setCommunicationTypeId] = useState(editing?.communication_type_id ?? "");
  const [channelDetail, setChannelDetail] = useState(editing?.channel_detail ?? "");
  const [externalUrl, setExternalUrl] = useState(editing?.external_url ?? "");
  const [bwResourceId, setBwResourceId] = useState(editing?.bw_resource_id ?? "");

  const [narrativeError, setNarrativeError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isDecision = recordType === "decision";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setNarrativeError(null);
    setTitleError(null);
    setDateError(null);
    setTypeError(null);
    setFormError(null);

    let hasError = false;
    if (!narrativeId) {
      setNarrativeError("Selecione uma Narrativa");
      hasError = true;
    }
    if (!title.trim()) {
      setTitleError("Informe um título");
      hasError = true;
    }
    const occurredAtIso = occurredAt ? new Date(occurredAt).toISOString() : "";
    if (!occurredAt || new Date(occurredAt).getTime() > Date.now()) {
      setDateError("A data não pode ser no futuro");
      hasError = true;
    }
    if (!isDecision && !communicationTypeId) {
      setTypeError("Selecione o tipo de comunicação");
      hasError = true;
    }
    if (hasError) return;

    setLoading(true);
    try {
      await onSubmit({
        narrative_id: narrativeId,
        record_type: recordType,
        title: title.trim(),
        description: description.trim() || null,
        occurred_at: occurredAtIso,
        assignee_id: assigneeId || null,
        communication_type_id: isDecision ? null : communicationTypeId || null,
        channel_detail: isDecision ? null : channelDetail.trim() || null,
        external_url: isDecision ? null : externalUrl.trim() || null,
        bw_resource_id: isDecision ? null : bwResourceId.trim() || null,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Algo deu errado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      title={isEditing ? "Editar registro" : "Registrar comunicação ou decisão"}
      onClose={onClose}
      maxWidthClassName="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {formError && (
          <p className="rounded-md bg-[#fdecea] px-3 py-2 text-sm text-[#a52820]" role="alert">
            {formError}
          </p>
        )}

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text-primary">Tipo de registro</span>
          <div className="flex rounded-md border border-border-default p-0.5">
            {(["communication", "decision"] as const).map((value) => (
              <button
                key={value}
                type="button"
                disabled={isEditing || loading}
                onClick={() => setRecordType(value)}
                className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                  recordType === value ? "bg-accent-blue text-white" : "text-text-secondary hover:bg-bg-page"
                }`}
              >
                {value === "communication" ? "Comunicação" : "Decisão"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text-primary">Narrativa</span>
          {lockedNarrative ? (
            <p className="rounded-md border border-border-default bg-bg-page px-3 py-2 text-sm text-text-primary">
              {lockedNarrative.title}
            </p>
          ) : (
            // Travado na edição de propósito, não só no `record_type`
            // (comentário do toggle acima): `organization_id` só é
            // derivado de `narrative_id` no INSERT
            // (`communications_set_organization`, BEFORE INSERT) — mudar
            // a Narrativa num UPDATE não re-derivaria a organização,
            // podendo deixar a linha com `organization_id` de uma
            // organização diferente da Narrativa atual. Reatribuir a
            // Narrativa de um registro existente não é suportado; excluir
            // e recriar.
            <NarrativeCombobox narratives={narratives} value={narrativeId} onChange={setNarrativeId} disabled={loading || isEditing} />
          )}
          {narrativeError && <p className="text-xs text-[#e0483e]">{narrativeError}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="comm-title" className="text-sm font-medium text-text-primary">
            Título
          </label>
          <input
            id="comm-title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={loading}
            className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
          />
          {titleError && <p className="text-xs text-[#e0483e]">{titleError}</p>}
        </div>

        {!isDecision && (
          <div className="flex flex-col gap-1">
            <label htmlFor="comm-type" className="text-sm font-medium text-text-primary">
              Tipo de comunicação
            </label>
            <select
              id="comm-type"
              value={communicationTypeId}
              onChange={(event) => setCommunicationTypeId(event.target.value)}
              disabled={loading}
              className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
            >
              <option value="">Selecione…</option>
              {communicationTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
            {typeError && <p className="text-xs text-[#e0483e]">{typeError}</p>}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="comm-description" className="text-sm font-medium text-text-primary">
            {isDecision ? "Detalhamento" : "Descrição"}
          </label>
          <textarea
            id="comm-description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={loading}
            className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
          />
        </div>

        {!isDecision && (
          <div className="flex flex-col gap-1">
            <label htmlFor="comm-channel" className="text-sm font-medium text-text-primary">
              Canal
            </label>
            <input
              id="comm-channel"
              type="text"
              placeholder="Ex: Instagram, Rede Globo"
              value={channelDetail}
              onChange={(event) => setChannelDetail(event.target.value)}
              disabled={loading}
              className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="comm-occurred-at" className="text-sm font-medium text-text-primary">
              {isDecision ? "Data da decisão" : "Data/hora da publicação"}
            </label>
            <input
              id="comm-occurred-at"
              type="datetime-local"
              value={occurredAt}
              max={toDatetimeLocalValue(new Date().toISOString())}
              onChange={(event) => setOccurredAt(event.target.value)}
              disabled={loading}
              className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
            />
            {dateError && <p className="text-xs text-[#e0483e]">{dateError}</p>}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="comm-assignee" className="text-sm font-medium text-text-primary">
              Responsável
            </label>
            <select
              id="comm-assignee"
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              disabled={loading}
              className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
            >
              <option value="">Sem responsável</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name ?? "Sem nome"}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!isDecision && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="comm-url" className="text-sm font-medium text-text-primary">
                Link/evidência
              </label>
              <input
                id="comm-url"
                type="url"
                value={externalUrl}
                onChange={(event) => setExternalUrl(event.target.value)}
                disabled={loading}
                className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="comm-bw-resource" className="text-sm font-medium text-text-primary">
                ID/URL da mention na Brandwatch
              </label>
              <input
                id="comm-bw-resource"
                type="text"
                value={bwResourceId}
                onChange={(event) => setBwResourceId(event.target.value)}
                disabled={loading}
                className="rounded-md border border-border-default px-3 py-2 text-sm outline-none focus:border-accent-blue disabled:opacity-60"
              />
            </div>
          </div>
        )}

        <div className="mt-2 flex justify-end gap-3">
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
            {isEditing ? "Salvar" : "Registrar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
