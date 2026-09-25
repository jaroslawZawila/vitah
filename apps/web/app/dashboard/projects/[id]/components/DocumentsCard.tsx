"use client";

// Container for the "Documents" card: the only part that knows about server
// actions. The views (DocumentList, DocumentUploadForm) take props only.

import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { ProjectDocument } from "@repo/core/contract";
import {
  addProjectDocumentAction,
  deleteProjectDocumentAction,
  type DocumentsState,
} from "../../../../actions/documents";
import shared from "../../../shared.module.css";
import DocumentList from "./DocumentList";
import DocumentUploadForm from "./DocumentUploadForm";

/** PDFs shared with the project's client in the mobile app. */
export default function DocumentsCard({
  projectId,
  documents,
  canManage,
}: {
  projectId: string;
  documents: ProjectDocument[];
  canManage: boolean;
}) {
  const t = useTranslations("projectDetailPage.documents");
  const [uploadState, upload, uploading] = useActionState(
    addProjectDocumentAction.bind(null, projectId),
    null,
  );
  const [deleteState, setDeleteState] = useState<DocumentsState>(null);
  const [deleting, startDelete] = useTransition();

  function handleDelete(document: ProjectDocument) {
    if (!confirm(t("confirmDelete", { title: document.title }))) return;
    startDelete(async () => {
      setDeleteState(await deleteProjectDocumentAction(projectId, document.id));
    });
  }

  return (
    <section className={shared.card} aria-labelledby="documents-title">
      <h2 id="documents-title" className={shared.cardTitle}>
        {t("title")}
      </h2>
      <DocumentList
        documents={documents}
        fileUrl={(document) => `/api/v1/projects/${projectId}/documents/${document.id}`}
        onDelete={canManage ? handleDelete : undefined}
        deleting={deleting}
        error={deleteState?.error}
      />
      {canManage && (
        <DocumentUploadForm action={upload} pending={uploading} error={uploadState?.error} />
      )}
    </section>
  );
}
