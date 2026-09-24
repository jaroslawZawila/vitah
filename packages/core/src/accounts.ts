import bcrypt from "bcryptjs";

// Helpers shared by everything that creates or authenticates user accounts.

// Tests lower the cost (see @repo/db/vitest); production always uses 12.
const BCRYPT_COST = Number(process.env.BCRYPT_COST ?? 12);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}
