"use server";

// Thin portal adapters over @repo/core (packages/core/src/project-client.ts),
// behind the "Client app access" card on the project page.

import {
  CoreError,
  projectClientService as svc,
  type Ctx,
  type ProjectClientError,
} from "@repo/core";
import { revalidatePath } from "next/cache";
import { requireSession } from "../../lib/access";
import { read } from "./run";

export type ClientAccessState = { error?: ProjectClientError; success?: boolean } | null;

/**
 * Clients the admin can pick for a project. Admins only, like the Clients
 * page: a page asks only for an admin, anyone else gets "No tienes permiso".
 */
export async function getAssignableClients() {
  return (await read((ctx) => svc.listAssignableClients(ctx)))?.data ?? [];
}

/** Runs a core mutation; returns `{ error: code }` for expected failures. */
async function mutate(
  projectId: string,
  fn: (ctx: Ctx) => Promise<unknown>,
): Promise<ClientAccessState> {
  const ctx = await requireSession();
  try {
    await fn(ctx);
  } catch (err) {
    if (err instanceof CoreError) return { error: err.code as ProjectClientError };
    throw err;
  }
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/dashboard/projects");
  return { success: true };
}

export async function assignProjectClientAction(
  projectId: string,
  _prevState: ClientAccessState,
  formData: FormData,
): Promise<ClientAccessState> {
  return mutate(projectId, (ctx) =>
    svc.assignProjectClient(ctx, projectId, Object.fromEntries(formData)),
  );
}

export async function unassignProjectClientAction(projectId: string): Promise<ClientAccessState> {
  return mutate(projectId, (ctx) => svc.unassignProjectClient(ctx, projectId));
}
