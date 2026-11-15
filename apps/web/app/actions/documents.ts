"use server";

// Thin portal adapters over @repo/core (packages/core/src/documents.ts),
// behind the project's Documents page.

import {
  CoreError,
  documentsService as svc,
  type BudgetInputRegistrationInput,
  type DocumentError,
  type ProjectDocument,
} from "@repo/core";
import { requireSession } from "../../lib/access";
import { mutate, read } from "./run";

export type DocumentsState = { error?: DocumentError; success?: boolean } | null;

/**
 * The project's documents and whether the caller may upload/delete. A
 * project that isn't the tenant's is the "No encontrado" page (`read`).
 */
export async function getProjectDocuments(
  projectId: string,
): Promise<{ documents: ProjectDocument[]; canManage: boolean }> {
  const result = await read((ctx) => svc.listDocuments(ctx, projectId));
  return { documents: result?.data ?? [], canManage: result?.canManage ?? false };
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
  const ctx = await requireSession();
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
  input: BudgetInputRegistrationInput,
): Promise<DocumentsState> {
  return mutate<DocumentError>(projectId, (ctx) => svc.registerBudgetInput(ctx, projectId, input));
}

export async function deleteProjectDocumentAction(
  projectId: string,
  documentId: string,
): Promise<DocumentsState> {
  return mutate<DocumentError>(projectId, (ctx) => svc.deleteDocument(ctx, projectId, documentId));
}
