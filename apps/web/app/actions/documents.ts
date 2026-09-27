"use server";

// Thin portal adapters over @repo/core (packages/core/src/documents.ts),
// behind the project's Documents page.

import {
  CoreError,
  canManageProjectFiles,
  documentsService as svc,
  type DocumentError,
  type ProjectDocument,
} from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { mutate } from "./run";

export type DocumentsState = { error?: DocumentError; success?: boolean } | null;

/**
 * The project's documents and whether the caller may upload/delete. Empty
 * when signed out or the project isn't in the tenant.
 */
export async function getProjectDocuments(
  projectId: string,
): Promise<{ documents: ProjectDocument[]; canManage: boolean }> {
  const ctx = await getSessionContext();
  if (!ctx) return { documents: [], canManage: false };
  const documents = await svc.listDocuments(ctx, projectId).catch((err: unknown) => {
    if (err instanceof CoreError) return [];
    throw err;
  });
  return { documents, canManage: canManageProjectFiles(ctx.role) };
}

export async function addProjectDocumentAction(
  projectId: string,
  _prevState: DocumentsState,
  formData: FormData,
): Promise<DocumentsState> {
  return mutate<DocumentError>(projectId, (ctx) => svc.addDocument(ctx, projectId, Object.fromEntries(formData)));
}

export async function deleteProjectDocumentAction(
  projectId: string,
  documentId: string,
): Promise<DocumentsState> {
  return mutate<DocumentError>(projectId, (ctx) => svc.deleteDocument(ctx, projectId, documentId));
}
