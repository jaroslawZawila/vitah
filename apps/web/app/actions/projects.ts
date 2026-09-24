"use server";

// Thin portal adapters over @repo/core. Business logic and tenant scoping
// live in packages/core/src/projects.ts (shared with /api/v1 for mobile);
// this file only resolves the session and revalidates portal pages.

import { CoreError, projectsService as svc, type Ctx } from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { revalidatePath } from "next/cache";

export type { ProjectWithRelations } from "@repo/core";

// Core function params minus the leading ctx.
type Args<F> = F extends (ctx: Ctx, ...rest: infer R) => unknown ? R : never;

async function requireAuth(): Promise<Ctx> {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("Unauthorized");
  return ctx;
}

function revalidateProject(projectId: string) {
  revalidatePath(`/dashboard/projects/${projectId}`);
}

// --- Projects ---

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

export async function createProject(
  _prevState: { error?: string; success?: boolean; id?: string } | null,
  formData: FormData,
) {
  const ctx = await requireAuth();
  try {
    const { id } = await svc.createProject(ctx, Object.fromEntries(formData));
    revalidatePath("/dashboard/projects");
    return { success: true, id };
  } catch (err) {
    if (err instanceof CoreError) return { error: err.code };
    throw err;
  }
}

export async function updateProject(id: string, data: Record<string, unknown>) {
  const ctx = await requireAuth();
  await svc.updateProject(ctx, id, data);
  revalidateProject(id);
  revalidatePath("/dashboard/projects");
}

export async function deleteProject(id: string) {
  const ctx = await requireAuth();
  await svc.deleteProject(ctx, id);
  revalidatePath("/dashboard/projects");
}

// --- Milestones ---

export async function updateMilestoneStatus(
  ...args: Args<typeof svc.updateMilestoneStatus>
) {
  const { projectId } = await svc.updateMilestoneStatus(await requireAuth(), ...args);
  revalidateProject(projectId);
}

// --- Quality Checks ---

export async function createQualityCheck(
  ...args: Args<typeof svc.createQualityCheck>
) {
  const { projectId } = await svc.createQualityCheck(await requireAuth(), ...args);
  revalidateProject(projectId);
}

export async function updateQualityCheck(
  ...args: Args<typeof svc.updateQualityCheck>
) {
  const { projectId } = await svc.updateQualityCheck(await requireAuth(), ...args);
  revalidateProject(projectId);
}

export async function deleteQualityCheck(id: string) {
  const { projectId } = await svc.deleteQualityCheck(await requireAuth(), id);
  revalidateProject(projectId);
}

// --- Tasks ---

export async function createTask(
  ...args: Args<typeof svc.createTask>
) {
  const { projectId } = await svc.createTask(await requireAuth(), ...args);
  revalidateProject(projectId);
}

export async function updateTask(
  ...args: Args<typeof svc.updateTask>
) {
  const { projectId } = await svc.updateTask(await requireAuth(), ...args);
  revalidateProject(projectId);
}

export async function deleteTask(id: string) {
  const { projectId } = await svc.deleteTask(await requireAuth(), id);
  revalidateProject(projectId);
}

// --- Material Orders ---

export async function createOrder(
  ...args: Args<typeof svc.createOrder>
) {
  const { projectId } = await svc.createOrder(await requireAuth(), ...args);
  revalidateProject(projectId);
}

export async function updateOrder(
  ...args: Args<typeof svc.updateOrder>
) {
  const { projectId } = await svc.updateOrder(await requireAuth(), ...args);
  revalidateProject(projectId);
}

export async function deleteOrder(id: string) {
  const { projectId } = await svc.deleteOrder(await requireAuth(), id);
  revalidateProject(projectId);
}

// --- Invoices ---

export async function createInvoice(
  ...args: Args<typeof svc.createInvoice>
) {
  const { projectId } = await svc.createInvoice(await requireAuth(), ...args);
  revalidateProject(projectId);
}

export async function updateInvoice(
  ...args: Args<typeof svc.updateInvoice>
) {
  const { projectId } = await svc.updateInvoice(await requireAuth(), ...args);
  revalidateProject(projectId);
}

export async function deleteInvoice(id: string) {
  const { projectId } = await svc.deleteInvoice(await requireAuth(), id);
  revalidateProject(projectId);
}

// --- Documents ---

export async function createDocument(
  ...args: Args<typeof svc.createDocument>
) {
  const { projectId } = await svc.createDocument(await requireAuth(), ...args);
  revalidateProject(projectId);
}

export async function deleteDocument(id: string) {
  const { projectId } = await svc.deleteDocument(await requireAuth(), id);
  revalidateProject(projectId);
}
