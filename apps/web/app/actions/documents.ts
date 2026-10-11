"use server";

// Thin portal adapters over @repo/core (packages/core/src/documents.ts),
// behind the project's Documents page.

import {
  CoreError,
  canEdit,
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
  return { documents, canManage: canEdit(ctx.role) };
}

export async function addProjectDocumentAction(
  projectId: string,
  _prevState: DocumentsState,
  formData: FormData,
): Promise<DocumentsState> {
  return mutate<DocumentError>(projectId, (ctx) => svc.addDocument(ctx, projectId, Object.fromEntries(formData)));
}

/** Shows a document in the client's app or hides it. */
export async function setDocumentVisibilityAction(
  projectId: string,
  documentId: string,
  visibleToClient: boolean,
): Promise<DocumentsState> {
  return mutate<DocumentError>(projectId, (ctx) =>
    svc.setDocumentVisibility(ctx, projectId, documentId, { visibleToClient }),
  );
}

/** Where the browser may upload a budget input (then registered below). */
export async function budgetInputUploadAction(
  projectId: string,
  filename: string,
): Promise<{ pathname?: string; error?: DocumentError }> {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("Unauthorized");
  try {
    return { pathname: (await svc.budgetInputUpload(ctx, projectId, filename)).pathname };
  } catch (err) {
    if (err instanceof CoreError) return { error: err.code as DocumentError };
    throw err;
  }
}

/** Uses a document already on the project as one of the budget's inputs. */
export async function markBudgetInputAction(
  projectId: string,
  documentId: string,
  budgetInput: string,
): Promise<DocumentsState> {
  return mutate<DocumentError>(projectId, (ctx) => svc.markBudgetInput(ctx, projectId, documentId, { budgetInput }));
}

/** Records a budget input the browser uploaded straight to the store. */
export async function registerBudgetInputAction(
  projectId: string,
  input: Record<string, unknown>,
): Promise<DocumentsState> {
  return mutate<DocumentError>(projectId, (ctx) => svc.registerBudgetInput(ctx, projectId, input));
}

export async function deleteProjectDocumentAction(
  projectId: string,
  documentId: string,
): Promise<DocumentsState> {
  return mutate<DocumentError>(projectId, (ctx) => svc.deleteDocument(ctx, projectId, documentId));
}
