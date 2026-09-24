"use server";

// Thin portal adapters over @repo/core (packages/core/src/project-client.ts),
// behind the "Client app access" card on the project page.

import { CoreError, projectClientService as svc, type Ctx } from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { revalidatePath } from "next/cache";

export type ClientAccessState = { error?: string; success?: boolean } | null;

/** Runs a core mutation; returns `{ error: code }` for expected failures. */
async function mutate(
  projectId: string,
  fn: (ctx: Ctx) => Promise<unknown>,
): Promise<ClientAccessState> {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("Unauthorized");
  try {
    await fn(ctx);
  } catch (err) {
    if (err instanceof CoreError) return { error: err.code };
    throw err;
  }
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { success: true };
}

export async function createProjectClientAction(
  projectId: string,
  _prevState: ClientAccessState,
  formData: FormData,
): Promise<ClientAccessState> {
  return mutate(projectId, (ctx) =>
    svc.createProjectClient(ctx, projectId, Object.fromEntries(formData)),
  );
}

export async function resetProjectClientPasswordAction(
  projectId: string,
  _prevState: ClientAccessState,
  formData: FormData,
): Promise<ClientAccessState> {
  return mutate(projectId, (ctx) =>
    svc.resetProjectClientPassword(ctx, projectId, Object.fromEntries(formData)),
  );
}

export async function revokeProjectClientAction(projectId: string): Promise<ClientAccessState> {
  return mutate(projectId, (ctx) => svc.revokeProjectClient(ctx, projectId));
}
