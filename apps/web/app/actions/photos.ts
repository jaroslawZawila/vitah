"use server";

// Thin portal adapters over @repo/core (packages/core/src/photos.ts), behind
// the project's Photos page.

import {
  CoreError,
  canManageProjectFiles,
  photosService as svc,
  type Ctx,
  type PhotoError,
  type ProjectPhoto,
} from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { revalidatePath } from "next/cache";

export type PhotosState = { error?: PhotoError; success?: boolean } | null;

/**
 * The project's photos and whether the caller may upload/delete. Empty when
 * signed out or the project isn't in the tenant.
 */
export async function getProjectPhotos(
  projectId: string,
): Promise<{ photos: ProjectPhoto[]; canManage: boolean }> {
  const ctx = await getSessionContext();
  if (!ctx) return { photos: [], canManage: false };
  const photos = await svc.listPhotos(ctx, projectId).catch((err: unknown) => {
    if (err instanceof CoreError) return [];
    throw err;
  });
  return { photos, canManage: canManageProjectFiles(ctx.role) };
}

/** Runs a core mutation; returns `{ error: code }` for expected failures. */
async function mutate(
  projectId: string,
  fn: (ctx: Ctx) => Promise<unknown>,
): Promise<PhotosState> {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("Unauthorized");
  try {
    await fn(ctx);
  } catch (err) {
    if (err instanceof CoreError) return { error: err.code as PhotoError };
    throw err;
  }
  // Every tab of the project, so counts and lists stay in step.
  revalidatePath(`/dashboard/projects/${projectId}`, "layout");
  return { success: true };
}

export async function addProjectPhotoAction(
  projectId: string,
  _prevState: PhotosState,
  formData: FormData,
): Promise<PhotosState> {
  return mutate(projectId, (ctx) => svc.addPhoto(ctx, projectId, Object.fromEntries(formData)));
}

export async function deleteProjectPhotoAction(
  projectId: string,
  photoId: string,
): Promise<PhotosState> {
  return mutate(projectId, (ctx) => svc.deletePhoto(ctx, projectId, photoId));
}
