import bcrypt from "bcryptjs";

// Helpers shared by everything that creates or authenticates user accounts.

// Tests lower the cost (see @repo/db/vitest); production always uses 12.
const BCRYPT_COST = Number(process.env.BCRYPT_COST ?? 12);

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True for a Postgres unique-constraint violation (e.g. a taken email). */
export function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps driver errors, keeping the original as `cause`.
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  return candidates.some(
    (e) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "23505",
  );
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}
