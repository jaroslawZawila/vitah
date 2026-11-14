"use server";

// Thin portal adapters over @repo/core (packages/core/src/deleted.ts): what
// users deleted, for an admin to see and restore.

import {
  CoreError,
  deletedService as svc,
  type DeletedError,
  type DeletedFilters,
  type DeletedKind,
  type DeletedList,
} from "@repo/core";
import { revalidatePath } from "next/cache";
import { requireSession } from "../../lib/access";
import { mutate, read, type ActionState } from "./run";

export type DeletedPage = { data: DeletedList; error?: undefined } | { data?: undefined; error: DeletedError };

/** The page's first records (admins only: anyone else gets the "No tienes permiso" page). */
export async function getDeleted() {
  return (await read((ctx) => svc.listDeleted(ctx)))?.data ?? null;
}

/** Another page of the list: the screen's filters and "Cargar más". */
export async function listDeletedAction(filters: DeletedFilters): Promise<DeletedPage> {
  const ctx = await requireSession();
  try {
    return { data: await svc.listDeleted(ctx, filters) };
  } catch (err) {
    if (err instanceof CoreError) return { error: err.code as DeletedError };
    throw err;
  }
}

/** Brings a deleted record back; every page that lists or counts it is refreshed. */
export async function restoreDeletedAction(kind: DeletedKind, id: string): Promise<ActionState<DeletedError>> {
  const state = await mutate<DeletedError>(null, (ctx) => svc.restoreDeleted(ctx, kind, id));
  if (state?.success) revalidatePath("/dashboard", "layout");
  return state;
}
