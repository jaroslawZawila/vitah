"use server";

// Thin portal adapters over @repo/core. Business logic and tenant scoping
// live in packages/core/src/projects.ts (shared with /api/v1);
// this file only resolves the session and revalidates portal pages.

import { budgetOverviewService, CoreError, projectsService as svc } from "@repo/core";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireSession } from "../../lib/access";

export type { ProjectDetail } from "@repo/core";

export type ProjectFormState = {
  error?: string;
  success?: boolean;
  id?: string;
} | null;

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

// The reads send a signed-out caller to the login page (`requireSession`),
// like `read` in ./run.

/** The tenant's projects. */
export async function getProjects() {
  return svc.listProjects(await requireSession());
}

/** The project list: every project with its budget's state (Presupuesto filter and pill) and its signals (Atención). */
export async function getProjectList() {
  return budgetOverviewService.listProjectsWithBudget(await requireSession(), { signals: true });
}

/**
 * The project. One that isn't there (deleted, another tenant's, a stale
 * link) is the "No encontrado" page, never null.
 */
export async function getProject(id: string) {
  const project = await svc.getProject(await requireSession(), id);
  if (!project) notFound();
  return project;
}

/** Creates a project from the new-project wizard's draft (plain values). */
export async function createProject(draft: Record<string, unknown>) {
  const ctx = await requireSession();
  return formResult(async () => {
    const { id } = await svc.createProject(ctx, draft);
    revalidatePath("/dashboard/projects");
    return { success: true, id };
  });
}

export async function updateProject(id: string, data: Record<string, unknown>) {
  const ctx = await requireSession();
  return formResult(async () => {
    await svc.updateProject(ctx, id, data);
    revalidatePath(`/dashboard/projects/${id}`);
    revalidatePath("/dashboard/projects");
    return { success: true };
  });
}

/** Archives the project (nothing is erased): it leaves the portal and the client's app. Admins only. */
export async function deleteProject(id: string) {
  const ctx = await requireSession();
  return formResult(async () => {
    await svc.deleteProject(ctx, id);
    revalidatePath("/dashboard/projects");
    return { success: true };
  });
}
