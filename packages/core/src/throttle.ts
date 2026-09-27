import { db, inArray, loginAttempts, lt, sql } from "@repo/db";

// ─── Login throttling ─────────────────────────────────────────────────────────
// Counts password attempts per key (an email, an IP, a user) in a fixed
// 15-minute window. Once a key is over its limit, attempts are refused without
// checking the password until the window ends, so passwords can't be guessed
// at speed. A successful attempt clears its keys (`clearAttempts`), so in
// effect only failures add up.
// ─────────────────────────────────────────────────────────────────────────────

export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;

/** A throttled key and the attempts it may have per window. */
export type ThrottleKey = { key: string; limit: number };

/**
 * Counts an attempt against every key and says whether any is now over its
 * limit (then don't check the password). Counting first, in one atomic
 * statement, means parallel attempts can't all slip in under the limit.
 */
export async function overLimit(keys: ThrottleKey[]): Promise<boolean> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - THROTTLE_WINDOW_MS);
  // Dates in raw SQL need the column's encoding.
  const at = (date: Date) => sql.param(date, loginAttempts.windowStart);
  const windowOpen = sql`${loginAttempts.windowStart} > ${at(cutoff)}`;
  const [counts] = await Promise.all([
    db
      .insert(loginAttempts)
      .values(keys.map(({ key }) => ({ key, failures: 1, windowStart: now })))
      .onConflictDoUpdate({
        target: loginAttempts.key,
        set: {
          failures: sql`CASE WHEN ${windowOpen} THEN ${loginAttempts.failures} + 1 ELSE 1 END`,
          windowStart: sql`CASE WHEN ${windowOpen} THEN ${loginAttempts.windowStart} ELSE ${at(now)} END`,
        },
      })
      .returning({ key: loginAttempts.key, attempts: loginAttempts.failures }),
    // Expired windows are never read again.
    db.delete(loginAttempts).where(lt(loginAttempts.windowStart, cutoff)),
  ]);
  return counts.some((row) => row.attempts > (keys.find((k) => k.key === row.key)?.limit ?? 0));
}

/** Forgets keys' attempts (after a successful one). */
export async function clearAttempts(keys: ThrottleKey[]) {
  await db.delete(loginAttempts).where(
    inArray(
      loginAttempts.key,
      keys.map((k) => k.key),
    ),
  );
}
