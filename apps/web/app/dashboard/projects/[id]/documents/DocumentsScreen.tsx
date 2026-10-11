"use client";

// Container for the Documents tab: the only part that knows about server
// actions. The views in ../components take props only.

import { useActionState, useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ProjectDocument } from "@repo/core/contract";
import {
  addProjectDocumentAction,
  deleteProjectDocumentAction,
  setDocumentVisibilityAction,
  type DocumentsState,
} from "../../../../actions/documents";
import DocumentList from "../components/DocumentList";
import DocumentUploadForm from "../components/DocumentUploadForm";
import EmptyState from "../components/EmptyState";
import { EmptyFolder } from "../components/illustrations";
import Modal from "../components/Modal";
import TabHeader from "../components/TabHeader";

/** The project's documents; staff choose which ones the client sees in the app. */
export default function DocumentsScreen({
  projectId,
  projectRef,
  documents,
  canManage,
}: {
  projectId: string;
  projectRef: string;
  documents: ProjectDocument[];
  canManage: boolean;
}) {
  const t = useTranslations("projectDetailPage.documents");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteState, setDeleteState] = useState<DocumentsState>(null);
  const [deleting, startDelete] = useTransition();

  function handleVisibility(document: ProjectDocument, visible: boolean) {
    startDelete(async () => {
      setDeleteState(await setDocumentVisibilityAction(projectId, document.id, visible));
    });
  }

  // The budget's documents (what the AI read, the PDFs of each issued revision) first.
  const groups = [
    { key: "budget", documents: documents.filter((d) => d.budgetInput || d.budgetPdf) },
    { key: "other", documents: documents.filter((d) => !d.budgetInput && !d.budgetPdf) },
  ].filter((g) => g.documents.length > 0);
  const visible = documents.filter((d) => d.visibleToClient).length;

  function handleDelete(document: ProjectDocument) {
    if (!confirm(t("confirmDelete", { title: document.title }))) return;
    startDelete(async () => {
      setDeleteState(await deleteProjectDocumentAction(projectId, document.id));
    });
  }

  return (
    <>
      <TabHeader
        projectRef={projectRef}
        title={t("title")}
        summary={
          documents.length > 0
            ? `${t("count", { count: documents.length })} · ${t("visibleCount", { count: visible })}`
            : t("count", { count: 0 })
        }
        action={
          canManage && (
            <Button type="button" onClick={() => setUploadOpen(true)}>
              <Upload size={16} aria-hidden />
              {t("upload")}
            </Button>
          )
        }
      />

      {documents.length === 0 ? (
        <EmptyState illustration={<EmptyFolder />} title={t("emptyTitle")} text={t("emptyText")} />
      ) : (
        groups.map((group) => (
          <section
            key={group.key}
            className={cn(cardVariants({ size: "list" }), "py-2")}
            aria-labelledby={`documents-${group.key}`}
          >
            <h2 id={`documents-${group.key}`} className="border-b pt-2 pb-2.5 text-[19px]">
              {t(`groups.${group.key}`)}
            </h2>
            <DocumentList
              documents={group.documents}
              fileUrl={(document) => `/api/v1/projects/${projectId}/documents/${document.id}`}
              onDelete={canManage ? handleDelete : undefined}
              onToggleVisibility={canManage ? handleVisibility : undefined}
              deleting={deleting}
              error={deleteState?.error}
            />
          </section>
        ))
      )}

      {canManage && (
        <Modal open={uploadOpen} onOpenChange={setUploadOpen} title={t("upload")}>
          <UploadDocument projectId={projectId} onDone={() => setUploadOpen(false)} />
        </Modal>
      )}
    </>
  );
}

/** Mounted only while the modal is open, so each upload starts afresh. */
function UploadDocument({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [state, upload, uploading] = useActionState(
    async (prev: DocumentsState, formData: FormData) => {
      const result = await addProjectDocumentAction(projectId, prev, formData);
      if (result?.success) onDone();
      return result;
    },
    null,
  );
  return (
    <DocumentUploadForm
      action={upload}
      pending={uploading}
      error={state?.error}
      onCancel={onDone}
    />
  );
}
