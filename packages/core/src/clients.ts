import { and, asc, clientProfiles, db, eq, isClientUser, users } from "@repo/db";
import { EMAIL_PATTERN, hashPassword, isUniqueViolation, replacePassword } from "./accounts";
import { requireAdmin, type Ctx } from "./context";
import type { ClientError, ClientListItem } from "./contract";
import { CoreError } from "./errors";
import { MAX_TEXT } from "./input";
import { passwordSchema } from "./inputs/accounts";
import { clientAccountSchema, clientSchema } from "./inputs/clients";
import { parse } from "./inputs/fields";

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
  weak_password: 400,
  email_exists: 409,
  not_found: 404,
  forbidden: 403,
};

function fail(code: ClientError): never {
  throw new CoreError(code, STATUS[code]);
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

  // The account first: what is missing, then the email; then the profile and the password.
  const account = parse(clientAccountSchema, input);
  if (!account.firstName || !account.surnames || !account.email || !account.password) fail("missing_fields");
  if (account.email.length > MAX_TEXT || !EMAIL_PATTERN.test(account.email)) fail("invalid_email");

  const { password, email, ...profile } = parse(clientSchema, input);
  const { firstName, surnames } = profile;
  const passwordHash = await hashPassword(password);

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

/**
 * Sets the password the client signs in to the app with (within the policy,
 * like any other). Body: { password }
 */
export async function setClientPassword(
  ctx: Ctx,
  clientId: string,
  input: Record<string, unknown>,
) {
  requireAdmin(ctx);

  // A reset also signs the client out of the app on every phone.
  const { password } = parse(passwordSchema, input);
  const updated = await replacePassword(and(eq(users.id, clientId), eq(users.tenantId, ctx.tenantId), isClientUser), password);
  if (updated.length === 0) fail("not_found");

  return { id: clientId };
}
