import { and, asc, clientProfiles, db, eq, isClientUser, users } from "@repo/db";
import { EMAIL_PATTERN, hashPassword, isUniqueViolation, normalizeEmail } from "./accounts";
import { requireAdmin, type Ctx } from "./context";
import { MIN_PASSWORD_LENGTH, type ClientError, type ClientListItem } from "./contract";
import { CoreError } from "./errors";

// ─── Clients ──────────────────────────────────────────────────────────────────
// Homeowners who use the mobile app. Each is a `users` row with role "client"
// (login: email + password) plus a `client_profiles` row (personal details).
// Managing clients is admin only.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS: Record<ClientError, number> = {
  missing_fields: 400,
  invalid_email: 400,
  invalid_date_of_birth: 400,
  invalid_phone: 400,
  password_too_short: 400,
  email_exists: 409,
  not_found: 404,
  forbidden: 403,
};

function fail(code: ClientError): never {
  throw new CoreError(code, STATUS[code]);
}

// Input parsing: API bodies and form values arrive as unknown / strings.

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Trimmed text, or null when empty. */
function optional(value: unknown): string | null {
  return text(value) || null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{5,19}$/;

/** YYYY-MM-DD that is a real calendar date, not in the future. */
function dateOfBirth(value: unknown): string | null {
  const raw = optional(value);
  if (raw === null) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  const valid =
    DATE_PATTERN.test(raw) &&
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === raw && // rejects 2026-02-31
    parsed.getTime() <= Date.now();
  if (!valid) fail("invalid_date_of_birth");
  return raw;
}

function phone(value: unknown): string | null {
  const raw = optional(value);
  if (raw !== null && !PHONE_PATTERN.test(raw)) fail("invalid_phone");
  return raw;
}

function password(value: unknown): string {
  // Passwords are not trimmed.
  const raw = typeof value === "string" ? value : "";
  if (raw.length < MIN_PASSWORD_LENGTH) fail("password_too_short");
  return raw;
}

export async function listClients(ctx: Ctx): Promise<ClientListItem[]> {
  requireAdmin(ctx);

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      active: users.active,
      createdAt: users.createdAt,
      firstName: clientProfiles.firstName,
      surnames: clientProfiles.surnames,
      dateOfBirth: clientProfiles.dateOfBirth,
      address: clientProfiles.address,
      phone: clientProfiles.phone,
    })
    .from(users)
    .leftJoin(clientProfiles, eq(clientProfiles.userId, users.id))
    .where(and(eq(users.tenantId, ctx.tenantId), isClientUser))
    .orderBy(asc(clientProfiles.surnames), asc(clientProfiles.firstName), asc(users.email));

  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/**
 * Creates a client account and its profile, atomically.
 * Body: { firstName, surnames, email, password, dateOfBirth?, address?, phone? }
 */
export async function createClient(ctx: Ctx, input: Record<string, unknown>) {
  requireAdmin(ctx);

  const firstName = text(input.firstName);
  const surnames = text(input.surnames);
  const email = normalizeEmail(text(input.email));
  if (!firstName || !surnames || !email || !input.password) fail("missing_fields");
  if (!EMAIL_PATTERN.test(email)) fail("invalid_email");

  const profile = {
    firstName,
    surnames,
    dateOfBirth: dateOfBirth(input.dateOfBirth),
    address: optional(input.address),
    phone: phone(input.phone),
  };
  const passwordHash = await hashPassword(password(input.password));

  try {
    const id = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          tenantId: ctx.tenantId,
          email,
          name: `${firstName} ${surnames}`,
          passwordHash,
          role: "client",
        })
        .returning({ id: users.id });
      await tx.insert(clientProfiles).values({ userId: user!.id, tenantId: ctx.tenantId, ...profile });
      return user!.id;
    });
    return { id };
  } catch (error) {
    // Email taken by a client in any tenant, or by anyone in this tenant.
    if (isUniqueViolation(error)) fail("email_exists");
    throw error;
  }
}

/** Sets the password the client signs in to the app with. Body: { password } */
export async function setClientPassword(
  ctx: Ctx,
  clientId: string,
  input: Record<string, unknown>,
) {
  requireAdmin(ctx);

  const passwordHash = await hashPassword(password(input.password));
  const updated = await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(and(eq(users.id, clientId), eq(users.tenantId, ctx.tenantId), isClientUser))
    .returning({ id: users.id });
  if (updated.length === 0) fail("not_found");

  return { id: clientId };
}
