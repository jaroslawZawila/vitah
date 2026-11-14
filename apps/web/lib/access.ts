import { redirect } from "next/navigation";
import type { Ctx } from "@repo/core";
import { getSessionContext } from "@repo/auth/context";

// Where the portal sends someone it can't serve: shared by the pages and the
// server actions (app/actions/run.ts).

export const LOGIN_HREF = "/";
/** The "No tienes permiso" page (app/dashboard/forbidden). */
export const FORBIDDEN_HREF = "/dashboard/forbidden";

/**
 * The signed-in staff member. Without a session (it ended, or was closed in
 * another tab) there is nothing to show or do: a page stops and the login
 * page opens; in a server action the browser goes there too.
 */
export async function requireSession(): Promise<Ctx> {
  const ctx = await getSessionContext();
  if (!ctx) redirect(LOGIN_HREF);
  return ctx;
}

/**
 * Leaves for the "No tienes permiso" page: the caller's role may not see or
 * do this. Used like `notFound()`. (Next's own `forbidden()` still needs the
 * experimental `authInterrupts` flag in 16.2; once it is stable, this is the
 * one place to switch.)
 */
export function forbidden(): never {
  redirect(FORBIDDEN_HREF);
}
