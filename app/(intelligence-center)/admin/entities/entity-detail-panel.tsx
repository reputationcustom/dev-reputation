"use client";

import {
  ENTITY_TYPE_LABEL,
  IDEOLOGIA_LABEL,
  INFLUENCE_LEVEL_LABEL,
  type Entity,
  type InfluenceLevel,
} from "./types";

// Painel de visualização ao lado da tabela — pedido do usuário: "ao
// selecionar uma linha... mostrar do lado direito o conteúdo daquela
// entidade cadastrada sem a necessidade de clicar em editar... se estiver
// apenas visualizando não há necessidade de abrir o registro." Mesmo
// mecanismo já usado em `/narratives` (tabela encolhe pra uma coluna
// elástica, painel fixo de 400px ao lado — ver
// app/(intelligence-center)/(analytics)/narratives/page.tsx) — só leitura,
// "Editar" é a única ação que abre o EntityFormModal.
export function EntityDetailPanel({
  entity,
  onClose,
  onEdit,
}: {
  entity: Entity;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">
          Entidade selecionada
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-medium text-text-secondary hover:text-accent-blue"
        >
          ✕ Fechar
        </button>
      </div>

      <div className="rounded-xl border border-border-default bg-bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* Plain <img>, não next/image — mesmo padrão do logo da
                Sidebar: URL externa arbitrária, sem domínio fixo pra
                configurar next/image (só um advisory lint warning, não
                erro). */}
            {entity.photo_url && (
              <img
                src={entity.photo_url}
                alt=""
                className="h-12 w-12 flex-shrink-0 rounded-full object-cover"
              />
            )}
            <div>
              <p className="text-base font-bold text-text-primary">{entity.name}</p>
              <span className="mt-1 inline-flex items-center rounded-full bg-bg-page px-2.5 py-0.5 text-xs font-medium text-text-secondary">
                {ENTITY_TYPE_LABEL[entity.type]}
              </span>
            </div>
          </div>
          <span
            className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              entity.is_active ? "bg-[#eafaf1] text-[#1a9d5c]" : "bg-bg-page text-text-tertiary"
            }`}
          >
            {entity.is_active ? "Ativa" : "Inativa"}
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
          <div>
            <dt className="text-xs font-medium text-text-tertiary">Cargo</dt>
            <dd className="text-text-primary">{entity.cargo ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-text-tertiary">Partido</dt>
            <dd className="text-text-primary">{entity.partido ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-text-tertiary">Ideologia</dt>
            <dd className="text-text-primary">
              {entity.ideologia ? (IDEOLOGIA_LABEL[entity.ideologia] ?? entity.ideologia) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-text-tertiary">Influência</dt>
            <dd className="text-text-primary">
              {entity.influence_level
                ? INFLUENCE_LEVEL_LABEL[entity.influence_level as InfluenceLevel]
                : "—"}
            </dd>
          </div>
        </dl>

        <div className="mt-5">
          <h4 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">
            Contas nas redes
          </h4>
          {entity.accounts.length === 0 ? (
            <p className="mt-2 text-sm text-text-tertiary">Nenhuma conta cadastrada.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {entity.accounts.map((account) => (
                <li key={account.id} className="rounded-md bg-bg-page px-3 py-2 text-sm">
                  <p className="text-text-primary">
                    <span className="font-medium">{account.platform}</span> · {account.username}
                  </p>
                  {account.url && (
                    <a
                      href={account.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-accent-blue hover:underline"
                    >
                      {account.url}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5">
          <h4 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">
            Classificação adicional
          </h4>
          {entity.tags.length === 0 ? (
            <p className="mt-2 text-sm text-text-tertiary">Nenhuma classificação cadastrada.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entity.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="rounded-full bg-bg-page px-2.5 py-1 text-xs text-text-secondary"
                >
                  <span className="font-medium text-text-primary">{tag.tag_type}:</span> {tag.tag_value}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5 border-t border-border-subtle pt-4">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Editar
          </button>
        </div>
      </div>
    </div>
  );
}
