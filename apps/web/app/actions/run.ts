import { CoreError, canEdit, type Ctx, type ObraError } from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { revalidatePath } from "next/cache";
import { reviewDocuments } from "../../lib/review-documents";

// Shared by the project's server actions (not itself a server action module):
// run a core call for the signed-in staff member.

export type ActionState<E extends string> = { error?: E; success?: boolean } | null;
export type ObraState = ActionState<ObraError>;

/**
 * A core read for the project page: null when signed out or when core rejects
 * it (e.g. another tenant's project), with whether the caller may edit.
 */
export async function read<T>(fn: (ctx: Ctx) => Promise<T>) {
  const ctx = await getSessionContext();
  if (!ctx) return null;
  try {
    return { data: await fn(ctx), canManage: canEdit(ctx.role) };
  } catch (err) {
    if (err instanceof CoreError) return null;
    throw err;
  }
}

/**
 * Runs a core mutation; returns `{ error: code }` for expected failures. With
 * a `projectId`, every tab of that project is refreshed; without, the caller
 * revalidates what it touched.
 */
export async function mutate<E extends string>(
  projectId: string | null,
  fn: (ctx: Ctx) => Promise<unknown>,
  /** Runs once the write is in (e.g. queueing an upload's review). */
  onSuccess?: (ctx: Ctx) => Promise<void>,
): Promise<ActionState<E>> {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("Unauthorized");
  try {
    await fn(ctx);
  } catch (err) {
    if (err instanceof CoreError) return { error: err.code as E };
    throw err;
  }
  await onSuccess?.(ctx);
  // Every tab of the project: counts, lists, the obra, budget and payments
  // all read from the same data.
  if (projectId) revalidatePath(`/dashboard/projects/${projectId}`, "layout");
  return { success: true };
}

/**
 * `mutate`, then refreshes every page under the dashboard: Compras' lists,
 * the obra's Compras and the rail's counts all read the same purchasing data.
 * With `review`, a write that uploads a purchase PDF queues it for the AI's
 * review, which runs after the response.
 */
export async function mutateDashboard(
  projectId: string | null,
  fn: (ctx: Ctx) => Promise<unknown>,
  { review = false } = {},
): Promise<ObraState> {
  const state = await mutate<ObraError>(projectId, fn, review ? reviewDocuments : undefined);
  if (state?.success) revalidatePath("/dashboard", "layout");
  return state;
}
