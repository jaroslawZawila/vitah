"use client";

// Container: register a worker, or show and edit one with their documents.
// "Acceso a obra" is the server's, but while the form's roles or company
// differ from the saved ones it is previewed in the browser (same rules:
// @repo/core/contract workerAccess).

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  WORKER_DOC_GROUPS,
  requirementsFor,
  workerAccess,
  workerName,
  type DocumentRequirement,
  type SubcontractorError,
  type WorkerDetail,
  type WorkerObra,
} from "@repo/core/contract";
import { todayInSpain } from "@repo/core/obra-calc";
import {
  createWorkerAction,
  markNotApplicableAction,
  rejectSubcontractorDocumentAction,
  requestSubcontractorDocumentsAction,
  updateWorkerAction,
  uploadSubcontractorDocumentAction,
  validateSubcontractorDocumentAction,
} from "../../../actions/subcontractors";
import { Card } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/field";
import FormError from "../../components/FormError";
import { AccessBadge } from "../components/Badges";
import DocumentList, { type DocumentGroup } from "../components/DocumentList";
import { companyHref, workerHref } from "../components/display";
import AccessCard from "../components/worker/AccessCard";
import WorkerForm from "../components/worker/WorkerForm";
import { documentFacts, emptyWorkerDraft, workerDraftFrom, type CompanyChoice } from "../components/worker/draft";
import { useDocumentActions, type DocumentActions } from "../useDocumentActions";

/** The document buttons' server actions, handed to useDocumentActions. */
const DOCUMENT_ACTIONS: DocumentActions = {
  upload: uploadSubcontractorDocumentAction,
  validate: validateSubcontractorDocumentAction,
  reject: rejectSubcontractorDocumentAction,
  notApplicable: markNotApplicableAction,
  request: requestSubcontractorDocumentsAction,
};

const WORKER_REQUIREMENTS: readonly DocumentRequirement[] = requirementsFor("worker");

export default function WorkerScreen({
  worker,
  companies,
  initialCompanyId = "",
  canManage,
}: {
  /** Null to register a new worker. */
  worker: WorkerDetail | null;
  companies: CompanyChoice[];
  initialCompanyId?: string;
  canManage: boolean;
}) {
  const t = useTranslations("subcontractors.worker");
  const tr = useTranslations("subcontractors");
  const router = useRouter();
  const [draft, setDraft] = useState(() => (worker ? workerDraftFrom(worker) : emptyWorkerDraft(initialCompanyId)));
  const [obraId, setObraId] = useState("");
  const [error, setError] = useState<SubcontractorError | undefined>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const company = companies.find((c) => c.id === draft.subcontractorId);
  const kind = worker?.subcontractorKind ?? company?.kind;
  const obra = worker?.obras.find((o) => o.projectId === obraId);

  // Roles and company decide what is asked of the worker: preview a change before it is saved.
  const changed =
    !worker ||
    worker.subcontractorId !== draft.subcontractorId ||
    [...worker.roles].sort().join() !== [...draft.roles].sort().join();
  const preview = (on: WorkerObra | undefined) =>
    workerAccess({
      // After a company change the documents move along, but its status is the new one's.
      company: (worker && worker.subcontractorId === draft.subcontractorId ? worker.companyStatus : company?.status) ?? "pendiente",
      docs: documentFacts(worker?.documents ?? []),
      roles: draft.roles,
      obra: on && { pssAdhesion: on.pssAdhesion ?? undefined, bookEntry: on.bookEntry, chapterCodes: on.chapterCodes },
      today: todayInSpain(),
    });
  const access = changed ? preview(obra) : (obra?.access ?? worker.access);
  const headerAccess = worker && (changed ? preview(undefined) : worker.access);

  function submit() {
    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      const result = worker ? await updateWorkerAction(worker.id, draft) : await createWorkerAction(draft);
      if (result?.error) return setError(result.error);
      if (!worker && result?.id) return router.push(workerHref(result.id));
      // updateWorkerAction's revalidatePath brings the saved worker back with it.
      setSaved(true);
    });
  }

  const name = worker ? workerName(worker) : t("newTitle");

  return (
    <>
      <header className="flex flex-col gap-1.5">
        <Link className="text-[12.5px] text-muted-foreground hover:text-foreground" href="/dashboard/subcontratas/trabajadores">
          ← {t("back")}
        </Link>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <h1>{name}</h1>
          {headerAccess && <AccessBadge status={headerAccess.status} />}
        </div>
        {worker && (
          <p className="m-0 text-[13px] text-muted-foreground">
            <Link className="underline-offset-3 hover:underline" href={companyHref(worker.subcontractorId)}>
              {worker.subcontractorName}
            </Link>
            {worker.trade && ` · ${tr(`trades.${worker.trade}`)}`}
            {worker.category && ` · ${tr(`categories.${worker.category}`)}`}
          </p>
        )}
      </header>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <WorkerForm
            draft={draft}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            companies={companies}
            canManage={canManage}
            pending={pending}
            error={error}
            submitLabel={worker ? t("save") : t("create")}
            onSubmit={submit}
          />
          {saved && (
            <FormMessage role="status" tone="success">
              {t("saved")}
            </FormMessage>
          )}
          {worker ? <WorkerDocuments worker={worker} canManage={canManage} /> : <p className="m-0 text-[13px] text-muted-foreground">{t("documentsAfter")}</p>}
        </div>
        <aside className="flex min-w-0 flex-col gap-3.5 lg:w-[340px] lg:flex-none">
          <AccessCard access={access} kind={kind} obras={worker?.obras ?? []} obraId={obraId} onObra={setObraId} />
          {worker && !draftMatches(worker, draft) && (
            <p className="m-0 text-[12.5px] text-muted-foreground">{t("unsaved")}</p>
          )}
        </aside>
      </div>
    </>
  );
}

function draftMatches(worker: WorkerDetail, draft: ReturnType<typeof workerDraftFrom>) {
  return JSON.stringify(workerDraftFrom(worker)) === JSON.stringify(draft);
}

function WorkerDocuments({ worker, canManage }: { worker: WorkerDetail; canManage: boolean }) {
  const t = useTranslations("subcontractors.worker.documents");
  const { handlers, dialogs, busy, error } = useDocumentActions(worker.subcontractorId, worker.subcontractorKind, DOCUMENT_ACTIONS);
  const groups: DocumentGroup[] = WORKER_DOC_GROUPS.map((group) => {
    const ids = new Set<string>(WORKER_REQUIREMENTS.filter((r) => r.group === group).map((r) => r.id));
    return { key: group, title: t(`groups.${group}`), documents: worker.documents.filter((d) => ids.has(d.requirementId)) };
  });
  return (
    <Card size="list" aria-labelledby="worker-documents-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2 pt-2">
        <h2 id="worker-documents-title">{t("title")}</h2>
        <span className="text-[12.5px] text-muted-foreground">{t("hint")}</span>
      </div>
      <FormError namespace="subcontractors.errors" error={error} />
      <DocumentList
        groups={groups}
        subcontractorId={worker.subcontractorId}
        kind={worker.subcontractorKind}
        canManage={canManage}
        busy={busy}
        {...handlers}
      />
      {dialogs}
    </Card>
  );
}
