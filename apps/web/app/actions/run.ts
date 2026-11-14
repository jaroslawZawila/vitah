import { CoreError, canEdit, type Ctx, type ObraError } from "@repo/core";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { forbidden, requireSession } from "../../lib/access";
import { reviewDocuments } from "../../lib/review-documents";

// Shared by the project's server actions (not itself a server action module):
// run a core call for the signed-in staff member.

export type ActionState<E extends string> = { error?: E; success?: boolean } | null;
export type ObraState = ActionState<ObraError>;

/**
 * A core read for a page, with whether the caller may edit. What it can't
 * give, it says, instead of the page guessing:
 * - signed out → the login page;
 * - the record isn't there (deleted, another tenant's, a stale link: core's
 *   404s) → the "No encontrado" page (`notFound()`);
 * - the caller's role may not read it (403) → the "No tienes permiso" page;
 * - any other expected failure → null, for the page to handle as it sees fit.
 *
 * `optional`: nothing there is an expected state the page handles itself
 * (no draft yet → back to the plan; a stale `?revision=` → the newest), so a
 * 404 is null too.
 */
export async function read<T>(fn: (ctx: Ctx) => Promise<T>, { optional = false } = {}) {
  const ctx = await requireSession();
  try {
    return { data: await fn(ctx), canManage: canEdit(ctx.role) };
  } catch (err) {
    if (!(err instanceof CoreError)) throw err;
    if (err.status === 403) forbidden();
    if (err.status === 404 && !optional) notFound();
    return null;
  }
}

/**
 * Runs a core mutation; returns `{ error: code }` for expected failures (and
 * sends a caller whose session ended to the login page). With a `projectId`,
 * every tab of that project is refreshed; without, the caller revalidates
 * what it touched.
 */
export async function mutate<E extends string>(
  projectId: string | null,
  fn: (ctx: Ctx) => Promise<unknown>,
  /** Runs once the write is in (e.g. queueing an upload's review). */
  onSuccess?: (ctx: Ctx) => Promise<void>,
): Promise<ActionState<E>> {
  // Signed out meanwhile: the browser goes to the login page.
  const ctx = await requireSession();
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
