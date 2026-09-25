"use client";

// Container for the Documents tab: the only part that knows about server
// actions. The views in ../components take props only.

import { useActionState, useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ProjectDocument } from "@repo/core/contract";
import {
  addProjectDocumentAction,
  deleteProjectDocumentAction,
  type DocumentsState,
} from "../../../../actions/documents";
import shared from "../../../shared.module.css";
import DocumentList from "../components/DocumentList";
import DocumentUploadForm from "../components/DocumentUploadForm";
import EmptyState from "../components/EmptyState";
import { EmptyFolder } from "../components/illustrations";
import Modal from "../components/Modal";
import TabHeader from "../components/TabHeader";
import tabStyles from "../components/TabHeader.module.css";

/** PDFs shared with the project's client in the mobile app. */
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
        summary={t("count", { count: documents.length })}
        action={
          canManage && (
            <button type="button" className={tabStyles.action} onClick={() => setUploadOpen(true)}>
              <Upload size={16} aria-hidden />
              {t("upload")}
            </button>
          )
        }
      />

      {documents.length === 0 ? (
        <EmptyState illustration={<EmptyFolder />} title={t("emptyTitle")} text={t("emptyText")} />
      ) : (
        <section className={shared.card} aria-label={t("title")}>
          <DocumentList
            documents={documents}
            fileUrl={(document) => `/api/v1/projects/${projectId}/documents/${document.id}`}
            onDelete={canManage ? handleDelete : undefined}
            deleting={deleting}
            error={deleteState?.error}
          />
        </section>
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
