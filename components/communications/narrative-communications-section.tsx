"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useNarrativeCommunicationTimeline } from "@/hooks/use-narrative-communication-timeline";
import { useCommunicationTypes } from "@/hooks/use-communication-types";
import { useOrganizationMembers } from "@/hooks/use-organization-members";
import { CommunicationFormModal, type CommunicationFormValues } from "@/components/communications/communication-form-modal";
import { ImpactTimeline } from "@/components/communications/impact-timeline";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";
import { Toast } from "@/components/ui/toast";
import { callFunction } from "@/lib/supabase/call-function";

// Seção "Comunicações e Decisões" do detalhe de Narrativa
// (intelligence-center/narratives-exploration.md — cross-reference pra
// communications/overview.md, "Integração com o menu e com
// intelligence-center"). Botão "+ Registrar" sempre visível (regra
// transversal #2), Narrativa pré-preenchida e travada no formulário —
// pedido explícito do usuário: "de dentro do modal e do detalhamento de
// uma narrativa, deve existir um botão para registrar uma comunicação".
export function NarrativeCommunicationsSection({
  organizationId,
  narrativeId,
  narrativeTitle,
  timezone,
}: {
  organizationId: string;
  narrativeId: string;
  narrativeTitle: string;
  timezone: string;
}) {
  const { status, items, retry } = useNarrativeCommunicationTimeline(organizationId, narrativeId);
  const { types } = useCommunicationTypes();
  const { members } = useOrganizationMembers(organizationId);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function handleSubmit(values: CommunicationFormValues) {
    await callFunction("create-communication", values);
    setModalOpen(false);
    setToast({ type: "success", message: values.record_type === "decision" ? "Decisão registrada" : "Comunicação registrada" });
    retry();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs text-text-tertiary">Ações de comunicação e decisões registradas para esta Narrativa.</p>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex-shrink-0 rounded-md bg-accent-blue px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
        >
          + Registrar
        </button>
      </div>

      {status === "loading" && (
        <div className="flex items-center justify-center py-6">
          <Spinner className="h-5 w-5 text-accent-blue" />
        </div>
      )}
      {status === "error" && <ErrorMessage message="Não foi possível carregar as comunicações e decisões." onRetry={retry} />}
      {status === "loaded" && (
        <>
          <ImpactTimeline items={items} timezone={timezone} compact narrativeId={narrativeId} />
          {items.length > 0 && items.length <= 3 && (
            <Link href={`/communications/${narrativeId}`} className="mt-3 inline-block text-sm font-medium text-accent-blue hover:underline">
              Ver linha do tempo completa →
            </Link>
          )}
        </>
      )}

      {modalOpen && (
        <CommunicationFormModal
          narratives={[]}
          communicationTypes={types}
          members={members}
          lockedNarrative={{ id: narrativeId, title: narrativeTitle }}
          onClose={() => setModalOpen(false)}
          onSubmit={handleSubmit}
        />
      )}

      {toast && <Toast type={toast.type} message={toast.message} />}
    </div>
  );
}
