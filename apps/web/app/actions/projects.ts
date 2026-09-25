"use server";

// Thin portal adapters over @repo/core. Business logic and tenant scoping
// live in packages/core/src/projects.ts (shared with /api/v1);
// this file only resolves the session and revalidates portal pages.

import { CoreError, projectsService as svc, type Ctx } from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { revalidatePath } from "next/cache";

export type { ProjectDetail } from "@repo/core";

export type ProjectFormState = {
  error?: string;
  success?: boolean;
  id?: string;
} | null;

async function requireAuth(): Promise<Ctx> {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("Unauthorized");
  return ctx;
}

/** Maps expected core failures to `{ error: code }` for the form. */
async function formResult(
  fn: () => Promise<ProjectFormState>,
): Promise<ProjectFormState> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CoreError) return { error: err.code };
    throw err;
  }
}

export async function getProjects() {
  const ctx = await getSessionContext();
  if (!ctx) return [];
  return svc.listProjects(ctx);
}

export async function getProject(id: string) {
  const ctx = await getSessionContext();
  if (!ctx) return null;
  return svc.getProject(ctx, id);
}

/** Creates a project from the new-project wizard's draft (plain values). */
export async function createProject(draft: Record<string, unknown>) {
  const ctx = await requireAuth();
  return formResult(async () => {
    const { id } = await svc.createProject(ctx, draft);
    revalidatePath("/dashboard/projects");
    return { success: true, id };
  });
}

export async function updateProject(id: string, data: Record<string, unknown>) {
  const ctx = await requireAuth();
  return formResult(async () => {
    await svc.updateProject(ctx, id, data);
    revalidatePath(`/dashboard/projects/${id}`);
    revalidatePath("/dashboard/projects");
    return { success: true };
  });
}

export async function deleteProject(id: string) {
  const ctx = await requireAuth();
  await svc.deleteProject(ctx, id);
  revalidatePath("/dashboard/projects");
}
