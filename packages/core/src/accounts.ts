import bcrypt from "bcryptjs";

// Helpers shared by everything that creates or authenticates user accounts.

// Tests lower the cost (see @repo/db/vitest); production always uses 12.
const BCRYPT_COST = Number(process.env.BCRYPT_COST ?? 12);

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
