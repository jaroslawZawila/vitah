"use client";

// Container logic shared by the company and worker pages: the document
// actions (upload, validate, reject, not applicable, request) and their
// dialogs. The screens hand it the server actions (DOCUMENT_ACTIONS), so they
// stay the only files that import them.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { SubcontractorDoc, SubcontractorError, SubcontractorKind } from "@repo/core/contract";
import type { SubcontractorState } from "../../actions/subcontractors";
import Modal from "../projects/[id]/components/Modal";
import type { DocumentHandlers } from "./components/DocumentList";
import { ReasonForm, UploadDocumentForm } from "./components/DocumentForms";
import { useRequirementName } from "./components/display";

type Dialog = { kind: "upload" | "reject" | "notApplicable"; doc: SubcontractorDoc } | null;

/** The server actions behind the document buttons. */
export type DocumentActions = {
  upload: (subcontractorId: string, formData: FormData) => Promise<SubcontractorState>;
  validate: (subcontractorId: string, documentId: string) => Promise<SubcontractorState>;
  reject: (subcontractorId: string, documentId: string, reason: string) => Promise<SubcontractorState>;
  notApplicable: (subcontractorId: string, requirementId: string, reason: string) => Promise<SubcontractorState>;
  request: (subcontractorId: string, input: Record<string, unknown>) => Promise<SubcontractorState>;
};

export function useDocumentActions(subcontractorId: string, kind: SubcontractorKind, actions: DocumentActions) {
  const t = useTranslations("subcontractors.documents");
  const name = useRequirementName();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<SubcontractorError | undefined>();
  const [busy, startTransition] = useTransition();

  /**
   * Runs an action; closes the dialog on success, keeps the error otherwise.
   * The action's revalidatePath brings the updated page back with it.
   */
  function run(fn: () => Promise<SubcontractorState>) {
    setError(undefined);
    startTransition(async () => {
      const result = await fn();
      if (result?.error) setError(result.error);
      else setDialog(null);
    });
  }

  const owner = (doc: SubcontractorDoc) => ({
    requirementId: doc.requirementId,
    ...(doc.workerId ? { workerId: doc.workerId } : {}),
    ...(doc.projectId ? { projectId: doc.projectId } : {}),
  });

  const open = (next: Dialog) => {
    setError(undefined);
    setDialog(next);
  };

  const handlers: DocumentHandlers = {
    onUpload: (doc) => open({ kind: "upload", doc }),
    onReject: (doc) => open({ kind: "reject", doc }),
    onNotApplicable: (doc) => open({ kind: "notApplicable", doc }),
    onValidate: (doc) => run(() => actions.validate(subcontractorId, doc.id!)),
    onRequest: (doc) => run(() => actions.request(subcontractorId, owner(doc))),
  };

  const docName = dialog ? name(dialog.doc.requirementId, kind) : "";
  const close = () => setDialog(null);
  // The two dialogs that only ask for a reason.
  const reasons = {
    reject: {
      title: t("rejectTitle", { document: docName }),
      label: t("rejectReason"),
      hint: t("rejectHint"),
      submit: t("reject"),
      action: (doc: SubcontractorDoc, reason: string) => actions.reject(subcontractorId, doc.id!, reason),
    },
    notApplicable: {
      title: t("notApplicableTitle", { document: docName }),
      label: t("notApplicableReason"),
      hint: undefined,
      submit: t("save"),
      action: (doc: SubcontractorDoc, reason: string) => actions.notApplicable(subcontractorId, doc.requirementId, reason),
    },
  };
  const reason = dialog && dialog.kind !== "upload" ? reasons[dialog.kind] : null;
  const dialogs = (
    <Modal
      open={dialog !== null}
      onOpenChange={(isOpen) => !isOpen && close()}
      title={dialog?.kind === "upload" ? t("uploadTitle", { document: docName }) : (reason?.title ?? "")}
    >
      {dialog?.kind === "upload" && (
        <UploadDocumentForm
          requirementId={dialog.doc.requirementId}
          hidden={owner(dialog.doc)}
          action={(formData) => run(() => actions.upload(subcontractorId, formData))}
          pending={busy}
          error={error}
          onCancel={close}
        />
      )}
      {dialog && reason && (
        <ReasonForm
          key={dialog.kind}
          label={reason.label}
          hint={reason.hint}
          submitLabel={reason.submit}
          action={(formData) => run(() => reason.action(dialog.doc, String(formData.get("reason") ?? "")))}
          pending={busy}
          error={error}
          onCancel={close}
        />
      )}
    </Modal>
  );

  // An action outside a dialog (validate, request) reports its error here.
  return { handlers, dialogs, busy, error: dialog ? undefined : error };
}
