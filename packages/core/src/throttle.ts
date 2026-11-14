import { and, db, eq, gt, inArray, loginAttempts, lt, sql } from "@repo/db";
import { logError } from "./log";
import { isConflict } from "./pg-errors";
import { sweepNowAndThen } from "./sweep";

// ─── Login throttling ─────────────────────────────────────────────────────────
// Failed password attempts are counted per key in a fixed 15-minute window
// (`login_attempts`), so passwords can't be guessed at speed.
//
// Signing in (portal and mobile app alike, `countSignIn`) keeps three counters:
//
//   1. pair:  an email from one IP    10 failures → that IP is refused for that email
//   2. ip:    one IP, across emails  100 failures → that IP is refused altogether
//   3. email: an email, from anywhere 100 failures → the email is "under attack":
//      each IP's allowance for it (1) drops to 3
//
// (1) and (2) are the caller's own counters and hard blocks: until the window
// ends the IP gets "too_many_attempts" without the password being looked at,
// right or wrong. (3) never blocks anyone by itself. Failures from other IPs
// must not lock an account's owner out (anyone who knows an email could do
// that with a hundred junk attempts), so the right password from an IP within
// its own allowance always signs in; a botnet just gets fewer guesses per
// address.
//
// What an attempt counts, in this order:
//
//   a. Its own counters (1) and (2), always, in one atomic statement and
//      before the password is looked at, so parallel attempts can't all slip
//      in under a limit. A refused attempt counts here too (it changes nothing:
//      the IP is refused until its window ends either way).
//   b. If (a) refuses it, nothing else: the password isn't checked and the
//      email's counter (3) is NOT touched. Only attempts whose password was
//      actually checked count email-wide, so one address hammering an email
//      adds at most its own allowance (10) to it and can never put it "under
//      attack" by itself: that takes failures from more than ten addresses.
//   c. Otherwise the email's counter (3), then the password is checked.
//   d. If the password was right (`succeeded`), the attempt was no failure:
//      it is taken back off (2) and (3), and (1) is forgotten altogether (what
//      that IP got wrong for the email before). The email's and the IP's other
//      failures stay.
//   e. If the password was right but a second step is still to come (the
//      portal's two-step verification asks for a code: `withdrawn`), the
//      attempt was no guess either: it is taken back off every counter, and
//      nothing is forgotten. The attempt that then brings the code is counted
//      like any other: a wrong code is a failure on the same counters as a
//      wrong password, so codes can't be guessed any faster, and asking for
//      the code step again never resets what wrong codes have counted.
//
// Whether the email is under attack is read (not counted) at (a): the 101st
// checked failure onwards. That threshold is deliberately soft: a few parallel
// attempts may see it a moment late, which costs nothing.
//
// An unknown email counts exactly like a wrong password and gets the same
// answer, so the counters give away nothing about which emails have accounts.
//
// Without an IP. All of it rests on the caller's IP being real: see `clientIp`
// in @repo/auth/credentials (on Vercel there always is one). When there is
// none (local dev, a host that sets no header) there are no per-IP counters:
// every such caller would share them, and ten junk attempts by a stranger
// would lock the owner out. Those attempts share one counter per email
// instead (`noip`), refused only past the email-wide threshold (100 failures
// per window, the right password included from then on). So guessing without
// an IP is still capped (100 per email per window, against 10 per IP), and
// locking an owner out takes a hundred attempts per window rather than ten.
// They count email-wide (3) like any checked failure. A right password takes
// its own attempt back off `noip`; it doesn't clear it (the counter is
// everyone's, not the caller's).
//
// A signed-in user changing their own password is throttled by user id
// instead (`overLimit`, see ./accounts.ts).
//
// Locks. Two statements deadlock when each holds a row the other waits for,
// so no statement here can: one that writes several rows takes them in key
// order (`countAttempt`; the sweep too, which also skips rows in use), and
// everything else (`succeeded` included) writes one row per statement. Should
// the database still abort the bookkeeping of a correct sign-in, it is logged
// and the sign-in goes through: the right password is never turned into an
// error by its own counters.
//
// A window that has ended is reset by the next attempt on its key, so rows
// left behind change nothing: they are only swept away now and then
// (./sweep.ts), to keep the table small. The attempt that draws the sweep
// waits for it.
// ─────────────────────────────────────────────────────────────────────────────

export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;

/** A throttled key and the attempts it may have per window. */
export type ThrottleKey = { key: string; limit: number };

const windowCutoff = (now = new Date()) => new Date(now.getTime() - THROTTLE_WINDOW_MS);

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Now and then (./sweep.ts), deletes the windows that have ended. Rows are
 * taken in key order and those another statement holds are left for the next
 * sweep, so it can't be part of a deadlock.
 */
const sweepExpired = () =>
  sweepNowAndThen("throttle.sweep_failed", () => {
    const expired = db
      .select({ key: loginAttempts.key })
      .from(loginAttempts)
      .where(lt(loginAttempts.windowStart, windowCutoff()))
      .orderBy(loginAttempts.key)
      .for("update", { skipLocked: true });
    return db.delete(loginAttempts).where(inArray(loginAttempts.key, expired));
  });

/**
 * Counts an attempt against every key, atomically (one statement, the rows
 * in key order), and returns each key's count in its current window, this
 * attempt included.
 */
async function countAttempt(keys: string[]): Promise<Map<string, number>> {
  const now = new Date();
  // Dates in raw SQL need the column's encoding.
  const at = (date: Date) => sql.param(date, loginAttempts.windowStart);
  const windowOpen = sql`${loginAttempts.windowStart} > ${at(windowCutoff(now))}`;
  const counts = await db
    .insert(loginAttempts)
    .values([...keys].sort(byKey).map((key) => ({ key, failures: 1, windowStart: now })))
    .onConflictDoUpdate({
      target: loginAttempts.key,
      set: {
        failures: sql`CASE WHEN ${windowOpen} THEN ${loginAttempts.failures} + 1 ELSE 1 END`,
        windowStart: sql`CASE WHEN ${windowOpen} THEN ${loginAttempts.windowStart} ELSE ${at(now)} END`,
      },
    })
    .returning({ key: loginAttempts.key, attempts: loginAttempts.failures });
  return new Map(counts.map((row) => [row.key, row.attempts]));
}

/** A key's count in its current window, without counting anything. */
async function currentCount(key: string): Promise<number> {
  const [row] = await db
    .select({ failures: loginAttempts.failures })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.key, key), gt(loginAttempts.windowStart, windowCutoff())));
  return row?.failures ?? 0;
}

/**
 * Counts an attempt against every key and says whether any is now over its
 * limit (then don't check the password).
 */
export async function overLimit(keys: ThrottleKey[]): Promise<boolean> {
  const counts = await countAttempt(keys.map((k) => k.key));
  await sweepExpired();
  return keys.some(({ key, limit }) => (counts.get(key) ?? 0) > limit);
}

/** Forgets keys' attempts (after a successful one). */
export async function clearAttempts(keys: ThrottleKey[]) {
  for (const key of keys.map((k) => k.key).sort(byKey)) await clearKey(key);
}

async function clearKey(key: string) {
  await db.delete(loginAttempts).where(eq(loginAttempts.key, key));
}

/** Takes one attempt back off a key: it turned out not to be a failure. */
async function uncountAttempt(key: string) {
  await db
    .update(loginAttempts)
    .set({ failures: sql`GREATEST(${loginAttempts.failures} - 1, 0)` })
    .where(eq(loginAttempts.key, key));
}

/**
 * `count`'s answer. Should the database abort it for another statement's sake
 * (the lock order above rules a deadlock out, so this is a safety net), it is
 * tried once more; a second abort is logged and answered with `fallback`.
 */
async function counted<T>(count: () => Promise<T>, fallback: T): Promise<T> {
  for (let retried = false; ; retried = true) {
    try {
      return await count();
    } catch (error) {
      if (!isConflict(error)) throw error;
      if (retried) {
        logError("throttle.count_failed", error);
        return fallback;
      }
    }
  }
}

/** Failed sign-ins allowed per window; the scheme is at the top of this file. */
export const SIGN_IN_LIMITS = {
  /** For an email from one IP. */
  emailFromIp: 10,
  /** The same, while the email is over its own limit. */
  emailFromIpUnderAttack: 3,
  /** For an email from anywhere: past it, the email is under attack. Also what attempts without an IP share per email. */
  email: 100,
  /** From one IP, across emails. */
  ip: 100,
};

/** No real address is longer; keeps a key within what the table's index takes. */
const MAX_KEY_EMAIL = 320;

/**
 * Counts a sign-in attempt for the (normalised) email from `ip` and says
 * whether it is refused: `blocked` means "answer too_many_attempts without
 * checking the password". Otherwise check it, and call `succeeded` if it was
 * right, so the attempt doesn't count as a failure. What is counted when is
 * at the top of this file.
 */
export async function countSignIn(scope: string, email: string, ip: string | undefined) {
  // JSON keeps the parts apart whatever they contain: the email is whatever
  // the caller typed, and must not be able to spell another key.
  const key = (kind: string, ...parts: string[]) => `signin-${kind}:${JSON.stringify(parts)}`;
  const address = email.slice(0, MAX_KEY_EMAIL);
  const anywhere = key("email", scope, address);
  // The caller's own counters: per IP, or the one all callers without an IP share for the email.
  const fromIp = ip ? key("pair", scope, address, ip) : undefined;
  const wholeIp = ip ? key("ip", ip) : undefined;
  const noIp = ip ? undefined : key("noip", scope, address);
  const own = [fromIp, wholeIp, noIp].filter((k): k is string => k !== undefined);

  const [counts, emailFailures] = await Promise.all([
    counted(() => countAttempt(own), new Map<string, number>()),
    currentCount(anywhere),
  ]);
  const count = (k: string | undefined) => (k === undefined ? 0 : (counts.get(k) ?? 0));
  // With this attempt the email would be past its limit.
  const underAttack = emailFailures >= SIGN_IN_LIMITS.email;
  const blocked =
    count(fromIp) > (underAttack ? SIGN_IN_LIMITS.emailFromIpUnderAttack : SIGN_IN_LIMITS.emailFromIp) ||
    count(wholeIp) > SIGN_IN_LIMITS.ip ||
    count(noIp) > SIGN_IN_LIMITS.email;

  // Only an attempt whose password is about to be checked counts email-wide.
  if (!blocked) await counted(() => countAttempt([anywhere]), null);
  await sweepExpired();

  return {
    blocked,
    /**
     * The password was right: this attempt is no failure, and the IP's earlier
     * ones for the email are forgotten. Never throws: counters that can't be
     * put right are logged, and the sign-in stands.
     */
    async succeeded() {
      try {
        // One row per statement (see "Locks" above).
        if (fromIp) await clearKey(fromIp);
        // One back, not all: signing in to one account mustn't reset guessing
        // at others from the IP, nor other callers' guessing at this email.
        for (const k of [wholeIp, noIp, anywhere]) if (k) await uncountAttempt(k);
      } catch (error) {
        logError("throttle.success_failed", error);
      }
    },
    /**
     * The password was right, but the sign-in is not done (a second step is
     * asked for): this attempt alone comes back off its counters. Never throws.
     */
    async withdrawn() {
      try {
        for (const k of [fromIp, wholeIp, noIp, anywhere]) if (k) await uncountAttempt(k);
      } catch (error) {
        logError("throttle.withdraw_failed", error);
      }
    },
  };
}
