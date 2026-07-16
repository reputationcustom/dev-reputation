"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useIntelligenceCenterHeader } from "@/components/intelligence-center/header-context";
import { useUserProfile } from "@/hooks/use-user-profile";
import { PageHeaderBar } from "@/components/intelligence-center/page-header-bar";
import { WidgetCard } from "@/components/intelligence-center/widget-card";
import { ImpactTimeline } from "@/components/communications/impact-timeline";
import { CommunicationFormModal, type CommunicationFormValues } from "@/components/communications/communication-form-modal";
import { useNarrativeCommunicationTimeline } from "@/hooks/use-narrative-communication-timeline";
import { useCommunicationTypes } from "@/hooks/use-communication-types";
import { useOrganizationMembers } from "@/hooks/use-organization-members";
import { callFunction } from "@/lib/supabase/call-function";
import { Toast } from "@/components/ui/toast";

const WINDOW_OPTIONS: (3 | 7 | 14)[] = [3, 7, 14];

// Acompanhamento pós-comunicação/decisão (communications/narrative-impact-tracking.md)
// — linha do tempo completa de uma Narrativa, com seletor de janela
// (3/7/14 dias, default 7) e botão de registro rápido (Narrativa
// pré-preenchida/travada).
export default function NarrativeCommunicationTimelinePage() {
  const params = useParams<{ narrativeId: string }>();
  const narrativeId = params.narrativeId;
  const { organizationId } = useIntelligenceCenterHeader();
  const { timezone } = useUserProfile();
  const [windowDays, setWindowDays] = useState<3 | 7 | 14>(7);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const { status, items, retry } = useNarrativeCommunicationTimeline(organizationId, narrativeId, windowDays);
  const { types } = useCommunicationTypes();
  const { members } = useOrganizationMembers(organizationId);

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
    <>
      <PageHeaderBar title="Acompanhamento pós-comunicação" />

      <div className="flex flex-col gap-6 p-8">
        <Link href="/communications" className="text-sm font-medium text-accent-blue hover:underline">
          ← Voltar para Comunicações e Decisões
        </Link>

        <WidgetCard title="Linha do tempo de impacto" status={status} onRetry={retry}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase text-text-tertiary">Janela de comparação</span>
              <div className="flex rounded-md border border-border-default p-0.5">
                {WINDOW_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setWindowDays(option)}
                    className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
                      windowDays === option ? "bg-accent-blue text-white" : "text-text-secondary hover:bg-bg-page"
                    }`}
                  >
                    {option} dias
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              + Registrar
            </button>
          </div>

          <ImpactTimeline items={items} timezone={timezone} />
        </WidgetCard>
      </div>

      {modalOpen && (
        <CommunicationFormModal
          narratives={[]}
          communicationTypes={types}
          members={members}
          lockedNarrative={{ id: narrativeId, title: items[0]?.title ?? "Narrativa selecionada" }}
          onClose={() => setModalOpen(false)}
          onSubmit={handleSubmit}
        />
      )}

      {toast && <Toast type={toast.type} message={toast.message} />}
    </>
  );
}
