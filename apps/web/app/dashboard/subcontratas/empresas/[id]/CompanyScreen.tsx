"use client";

// Container for a company's ficha: the only part that knows about server
// actions (with ../../useDocumentActions for its documents). The views in
// ../../components/company take props only.

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  MANDATORY_COMPANY_REQUIREMENTS,
  workerName,
  type ProjectOption,
  type SubcontractorAssignment,
  type SubcontractorDetail,
  type SubcontractorError,
} from "@repo/core/contract";
import {
  assignSubcontractorAction,
  markNotApplicableAction,
  rejectSubcontractorDocumentAction,
  removeSubcontractorAssignmentAction,
  requestSubcontractorDocumentsAction,
  uploadSubcontractorDocumentAction,
  validateSubcontractorDocumentAction,
} from "../../../../actions/subcontractors";
import FormError from "../../../components/FormError";
import { cardVariants } from "@/components/ui/card";
import BlockingBanner from "../../components/company/BlockingBanner";
import CompanyHeader from "../../components/company/CompanyHeader";
import CompanyTabs from "../../components/company/CompanyTabs";
import type { CompanyTab } from "../../components/company/tabs";
import HistoryList from "../../components/company/HistoryList";
import ObrasTab from "../../components/company/ObrasTab";
import type { AssignmentValues } from "../../components/fields/draft";
import SummaryTab from "../../components/company/SummaryTab";
import WorkersTab from "../../components/company/WorkersTab";
import DocumentList, { type DocumentGroup } from "../../components/DocumentList";
import { useDocumentActions, type DocumentActions } from "../../useDocumentActions";

/** The document buttons' server actions, handed to useDocumentActions. */
const DOCUMENT_ACTIONS: DocumentActions = {
  upload: uploadSubcontractorDocumentAction,
  validate: validateSubcontractorDocumentAction,
  reject: rejectSubcontractorDocumentAction,
  notApplicable: markNotApplicableAction,
  request: requestSubcontractorDocumentsAction,
};

const MANDATORY = new Set<string>(MANDATORY_COMPANY_REQUIREMENTS.map((r) => r.id));

export default function CompanyScreen({
  company,
  projects,
  initialTab,
}: {
  company: SubcontractorDetail;
  projects: ProjectOption[];
  initialTab: CompanyTab;
}) {
  const t = useTranslations("subcontractors.company");
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<CompanyTab>(initialTab);
  const [error, setError] = useState<SubcontractorError | undefined>();
  const [busy, startTransition] = useTransition();
  const documents = useDocumentActions(company.id, company.kind, DOCUMENT_ACTIONS);

  function changeTab(next: CompanyTab) {
    setTab(next);
    router.replace(`${pathname}?tab=${next}`, { scroll: false });
  }

  /**
   * Runs an action; resolves true when it succeeded. Its revalidatePath brings
   * the updated page back with the response, so no refresh is needed.
   */
  function run(fn: () => ReturnType<typeof assignSubcontractorAction>) {
    setError(undefined);
    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        const result = await fn();
        if (result?.error) setError(result.error);
        resolve(!result?.error);
      });
    });
  }

  const expired = company.documents.filter((d) => company.status.expired.includes(d.requirementId));
  const groups: DocumentGroup[] = [
    { key: "mandatory", title: t("documents.mandatory"), documents: company.documents.filter((d) => MANDATORY.has(d.requirementId)) },
    { key: "optional", title: t("documents.optional"), documents: company.documents.filter((d) => !MANDATORY.has(d.requirementId)) },
    ...company.assignments.map((a) => ({
      key: a.projectId,
      title: t("documents.obra", { ref: a.projectRef }),
      documents: [a.pssAdhesion],
    })),
  ];

  const save = (projectId: string, values: AssignmentValues) =>
    run(() => assignSubcontractorAction(company.id, projectId, values));

  function remove(assignment: SubcontractorAssignment) {
    if (!confirm(t("obras.confirmRemove", { ref: assignment.projectRef }))) return;
    void run(() => removeSubcontractorAssignmentAction(company.id, assignment.projectId));
  }

  return (
    <>
      <CompanyHeader company={company} />
      {company.status.status === "bloqueada" && (
        <BlockingBanner
          expired={expired}
          kind={company.kind}
          workerNames={company.workers.map(workerName)}
          canManage={company.canManage}
          busy={busy}
          onRequest={() =>
            void run(() =>
              requestSubcontractorDocumentsAction(company.id, { requirementIds: company.status.expired }),
            )
          }
        />
      )}
      {tab !== "obras" && <FormError namespace="subcontractors.errors" error={error} />}

      <CompanyTabs
        tab={tab}
        counts={{
          documentos: company.documents.length + company.assignments.length,
          trabajadores: company.workers.length,
          obras: company.assignments.length,
        }}
        onChange={changeTab}
      />

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="flex flex-col gap-4">
        {tab === "resumen" && <SummaryTab company={company} />}
        {tab === "documentos" && (
          <section className={cardVariants()} aria-labelledby="documents-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="documents-title">{t("documents.title")}</h2>
              <span className="text-[12.5px] text-muted-foreground">{t("documents.hint")}</span>
            </div>
            <FormError namespace="subcontractors.errors" error={documents.error} />
            <DocumentList
              groups={groups}
              subcontractorId={company.id}
              kind={company.kind}
              canManage={company.canManage}
              busy={documents.busy}
              {...documents.handlers}
            />
            {documents.dialogs}
          </section>
        )}
        {tab === "trabajadores" && (
          <WorkersTab
            workers={company.workers}
            subcontractorId={company.id}
            kind={company.kind}
            canManage={company.canManage}
          />
        )}
        {tab === "obras" && (
          <ObrasTab
            assignments={company.assignments}
            projects={projects}
            kind={company.kind}
            canManage={company.canManage}
            busy={busy}
            error={error}
            onSave={save}
            onRemove={remove}
          />
        )}
        {tab === "historial" && <HistoryList entries={company.history} kind={company.kind} />}
      </div>
    </>
  );
}
