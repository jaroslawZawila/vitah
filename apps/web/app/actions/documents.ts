"use server";

// Thin portal adapters over @repo/core (packages/core/src/documents.ts),
// behind the "Documents" card on the project page.

import {
  CoreError,
  canManageDocuments,
  documentsService as svc,
  type Ctx,
  type DocumentError,
  type ProjectDocument,
} from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { revalidatePath } from "next/cache";

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
  return { documents, canManage: canManageDocuments(ctx.role) };
}

/** Runs a core mutation; returns `{ error: code }` for expected failures. */
async function mutate(
  projectId: string,
  fn: (ctx: Ctx) => Promise<unknown>,
): Promise<DocumentsState> {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("Unauthorized");
  try {
    await fn(ctx);
  } catch (err) {
    if (err instanceof CoreError) return { error: err.code as DocumentError };
    throw err;
  }
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { success: true };
}

export async function addProjectDocumentAction(
  projectId: string,
  _prevState: DocumentsState,
  formData: FormData,
): Promise<DocumentsState> {
  return mutate(projectId, (ctx) => svc.addDocument(ctx, projectId, Object.fromEntries(formData)));
}

export async function deleteProjectDocumentAction(
  projectId: string,
  documentId: string,
): Promise<DocumentsState> {
  return mutate(projectId, (ctx) => svc.deleteDocument(ctx, projectId, documentId));
}
