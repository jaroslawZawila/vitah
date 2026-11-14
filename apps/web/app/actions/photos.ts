"use server";

// Thin portal adapters over @repo/core (packages/core/src/photos.ts), behind
// the project's Photos page.

import { photosService as svc, type PhotoError, type ProjectPhoto } from "@repo/core";
import { mutate, read } from "./run";

export type PhotosState = { error?: PhotoError; success?: boolean } | null;

/**
 * The project's photos and whether the caller may upload/delete. A project
 * that isn't the tenant's is the "No encontrado" page (`read`).
 */
export async function getProjectPhotos(
  projectId: string,
): Promise<{ photos: ProjectPhoto[]; canManage: boolean }> {
  const result = await read((ctx) => svc.listPhotos(ctx, projectId));
  return { photos: result?.data ?? [], canManage: result?.canManage ?? false };
}

export async function addProjectPhotoAction(
  projectId: string,
  _prevState: PhotosState,
  formData: FormData,
): Promise<PhotosState> {
  return mutate<PhotoError>(projectId, (ctx) => svc.addPhoto(ctx, projectId, Object.fromEntries(formData)));
}

/** Shows a photo in the client's app or hides it. */
export async function setPhotoVisibilityAction(
  projectId: string,
  photoId: string,
  visibleToClient: boolean,
): Promise<PhotosState> {
  return mutate<PhotoError>(projectId, (ctx) => svc.setPhotoVisibility(ctx, projectId, photoId, { visibleToClient }));
}

export async function deleteProjectPhotoAction(
  projectId: string,
  photoId: string,
): Promise<PhotosState> {
  return mutate<PhotoError>(projectId, (ctx) => svc.deletePhoto(ctx, projectId, photoId));
}
