import bcrypt from "bcryptjs";
import { db, inArray, pushTokens, users, type SQL } from "@repo/db";

// Helpers shared by everything that creates or authenticates user accounts.

// Tests lower the cost (see @repo/db/vitest); production always uses 12.
// Outside tests a lower or malformed BCRYPT_COST is ignored, so a stray
// variable can't weaken every password hash.
const BCRYPT_COST = bcryptCost(process.env.BCRYPT_COST, process.env.NODE_ENV);

export function bcryptCost(raw: string | undefined, nodeEnv: string | undefined): number {
  const cost = Number(raw);
  if (!Number.isInteger(cost) || cost < 4 || cost > 15) return 12;
  return nodeEnv === "test" ? cost : Math.max(cost, 12);
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type PgError = { code?: unknown; constraint_name?: unknown };

function pgError(error: unknown): PgError | undefined {
  // Drizzle wraps driver errors, keeping the original as `cause`.
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  return candidates.find(
    (e): e is PgError => typeof e === "object" && e !== null && (e as PgError).code === "23505",
  );
}

/** True for a Postgres unique-constraint violation (e.g. a taken email). */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = pgError(error);
  return pg !== undefined && (constraint === undefined || pg.constraint_name === constraint);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Sets the password of the user(s) matching `where` and signs them out of the
 * app everywhere: `passwordChangedAt` revokes their mobile tokens (see
 * @repo/auth/mobile) and their phones stop getting pushes. The phone that made
 * the change registers again with its fresh token. Returns the users changed.
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
