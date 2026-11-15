import bcrypt from "bcryptjs";
import { db, inArray, pushTokens, users, type SQL } from "@repo/db";
import { CoreError, invalid, notFound } from "./errors";
import { mobileSignInSchema, passwordChangeSchema, portalSignInSchema } from "./inputs/accounts";
import { parse } from "./inputs/fields";
import { clearAttempts, overLimit, type ThrottleKey } from "./throttle";

// Helpers shared by everything that creates or authenticates user accounts.

// Where it always was for its callers; the database's errors are read in ./pg-errors.
export { isUniqueViolation } from "./pg-errors";

// Tests lower the cost (see @repo/db/vitest); production always uses 12.
// Outside tests a lower or malformed BCRYPT_COST is ignored, so a stray
// variable can't weaken every password hash.
const BCRYPT_COST = bcryptCost(process.env.BCRYPT_COST, process.env.NODE_ENV);

export function bcryptCost(raw: string | undefined, nodeEnv: string | undefined): number {
  const cost = Number(raw);
  if (!Number.isInteger(cost) || cost < 4 || cost > 15) return 12;
  return nodeEnv === "test" ? cost : Math.max(cost, 12);
}

// Where it always was for its callers; it lives with the other patterns in ./input (no database there).
export { EMAIL_PATTERN } from "./input";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The portal's sign-in form (@repo/auth's `authorize`): email and password as
 * they came, none trimmed (a blank email still counts as a failed sign-in);
 * the two-step code as typed, undefined when it isn't text.
 */
export function portalCredentials(credentials: Partial<Record<string, unknown>> | undefined) {
  return parse(portalSignInSchema, credentials ?? {});
}

/**
 * The app's sign-in body (POST /api/mobile/auth), parsed JSON: the email
 * trimmed, the password as typed, undefined what isn't text (an array or a
 * number has neither). Null for JSON's `null`, which the route always refused
 * as no body at all (`invalid_body`).
 */
export function mobileCredentials(body: unknown) {
  if (body === null) return null;
  return parse(mobileSignInSchema, typeof body === "object" && !Array.isArray(body) ? body : {});
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Sets the password of the user(s) matching `where` and signs them out
 * everywhere: `passwordChangedAt` revokes the portal sessions and the tokens
 * issued before it (see @repo/auth: `revokedByPasswordChange`) and their
 * phones stop getting pushes. Whoever made the change for themselves signs in
 * again (the portal) or gets a fresh token (the app). Returns the users changed.
 */
export async function replacePassword(where: SQL | undefined, password: string) {
  const passwordHash = await hashPassword(password);
  const now = new Date();
  return db.transaction(async (tx) => {
    const changed = await tx
      .update(users)
      .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
      .where(where)
      .returning({ id: users.id });
    if (changed.length > 0) {
      await tx.delete(pushTokens).where(
        inArray(
          pushTokens.userId,
          changed.map((u) => u.id),
        ),
      );
    }
    return changed;
  });
}

/** Wrong current passwords a user may enter per throttle window. */
const PASSWORD_ATTEMPTS = 10;

/** The counter of a signed-in user's wrong current passwords, wherever one is asked for. */
export const passwordThrottle = (userId: string): ThrottleKey => ({ key: `password:${userId}`, limit: PASSWORD_ATTEMPTS });

/**
 * The user matching `where` changes their own password.
 * Body: { currentPassword, newPassword }. Needs the current one (throttled per
 * user: `too_many_attempts` after PASSWORD_ATTEMPTS wrong ones) and a new one
 * within the policy; `refuseSame` also refuses the current one again.
 * Every session and token of the user is revoked (see `replacePassword`).
 */
export async function changeOwnPassword(
  where: SQL | undefined,
  userId: string,
  input: Record<string, unknown>,
  { refuseSame = false } = {},
) {
  const { currentPassword, newPassword: next } = parse(passwordChangeSchema, input);

  const throttle = [passwordThrottle(userId)];
  if (await overLimit(throttle)) throw new CoreError("too_many_attempts", 429);

  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(where).limit(1);
  if (!user) throw notFound();
  if (!user.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    // Not 401: the app treats 401 as "signed out".
    throw invalid("wrong_password");
  }
  await clearAttempts(throttle);
  if (refuseSame && next === currentPassword) throw invalid("same_password");

  await replacePassword(where, next);
}
