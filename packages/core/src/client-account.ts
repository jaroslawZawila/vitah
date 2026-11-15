import {
  and,
  clientSettings,
  db,
  desc,
  eq,
  inArray,
  isClientUser,
  isNotNull,
  isNull,
  pushTokens,
  users,
} from "@repo/db";
import { changeOwnPassword } from "./accounts";
import type { AccountError, DeletionRequest, MobileSettings } from "./contract";
import { CoreError } from "./errors";
import { logWarn } from "./log";
import { clientErrorReportSchema, clientSettingsSchema, pushTokenRemovalSchema, pushTokenSchema } from "./inputs/clients";
import { parse } from "./inputs/fields";

// ─── Client account ──────────────────────────────────────────────────────────
// What a signed-in client manages themselves in the app's Perfil tab: their
// password and notifications, the phones that get pushes, and asking for the
// account to be deleted.
// Called with the client's own identity (from their mobile token).
// ─────────────────────────────────────────────────────────────────────────────

const STATUS: Record<AccountError, number> = {
  missing_fields: 400,
  // Not 401: the app treats 401 as "signed out".
  wrong_password: 400,
  too_many_attempts: 429,
  weak_password: 400,
  invalid_settings: 400,
  invalid_token: 400,
  not_found: 404,
};

function fail(code: AccountError): never {
  throw new CoreError(code, STATUS[code]);
}

/** The mobile-app client `clientUserId` of the tenant. */
export const clientUser = (tenantId: string, clientUserId: string) =>
  and(eq(users.id, clientUserId), eq(users.tenantId, tenantId), isClientUser);

/**
 * Body: { currentPassword, newPassword }. The new one must pass `isStrongPassword`;
 * 10 wrong current ones are `too_many_attempts` for a while.
 * Revokes the client's existing mobile tokens (`passwordChangedAt`): the
 * caller hands the app a fresh one.
 */
export async function changePassword(
  tenantId: string,
  clientUserId: string,
  input: Record<string, unknown>,
) {
  await changeOwnPassword(clientUser(tenantId, clientUserId), clientUserId, input);
  return { success: true };
}

/** A client's settings; no settings row (and no deletion request) means these. */
export const DEFAULT_SETTINGS: MobileSettings = {
  notifications: { progress: true, documents: true, messages: true },
  deletionRequestedAt: null,
};

type Flags = {
  notifyProgress: boolean | null;
  notifyDocuments: boolean | null;
  notifyMessages: boolean | null;
};

/** Settings from a settings row; a missing row (or a left join's nulls) means the defaults. */
export function settingsOf(row: Flags | undefined): MobileSettings {
  const defaults = DEFAULT_SETTINGS.notifications;
  return {
    notifications: {
      progress: row?.notifyProgress ?? defaults.progress,
      documents: row?.notifyDocuments ?? defaults.documents,
      messages: row?.notifyMessages ?? defaults.messages,
    },
  };
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

export async function getSettings(tenantId: string, clientUserId: string): Promise<MobileSettings> {
  const [row, user] = await Promise.all([
    db.query.clientSettings.findFirst({
      where: and(eq(clientSettings.userId, clientUserId), eq(clientSettings.tenantId, tenantId)),
    }),
    db.query.users.findFirst({
      where: clientUser(tenantId, clientUserId),
      columns: { deletionRequestedAt: true },
    }),
  ]);
  return { ...settingsOf(row), deletionRequestedAt: iso(user?.deletionRequestedAt ?? null) };
}

const COLUMNS = {
  progress: "notifyProgress",
  documents: "notifyDocuments",
  messages: "notifyMessages",
} as const;

/** Body: { notifications: { progress?, documents?, messages? } }. Returns the new settings. */
export async function updateSettings(
  tenantId: string,
  clientUserId: string,
  input: Record<string, unknown>,
): Promise<MobileSettings> {
  const { notifications } = parse(clientSettingsSchema, input);
  const changes: Partial<Record<(typeof COLUMNS)[keyof typeof COLUMNS], boolean>> = {};
  for (const [key, column] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, (typeof COLUMNS)[keyof typeof COLUMNS]][]) {
    const value = notifications[key];
    if (value !== undefined) changes[column] = value;
  }

  const user = await db.query.users.findFirst({
    where: clientUser(tenantId, clientUserId),
    columns: { deletionRequestedAt: true },
  });
  if (!user) fail("not_found");

  // Only the sent flags change; a new row starts from the defaults.
  const [row] = await db
    .insert(clientSettings)
    .values({ userId: clientUserId, tenantId, ...changes })
    .onConflictDoUpdate({
      target: clientSettings.userId,
      set: { ...changes, updatedAt: new Date() },
    })
    .returning();
  return { ...settingsOf(row), deletionRequestedAt: iso(user.deletionRequestedAt) };
}

// ─── Asking for the account to be deleted ────────────────────────────────────
// Accounts are the builder's: the client only asks, and staff handle it by
// hand (the request shows on Clientes). Nothing is deleted or deactivated here.

const activeClient = (tenantId: string, clientUserId: string) =>
  and(clientUser(tenantId, clientUserId), eq(users.active, true));

/** One log line per request made, withdrawn or cleared by staff: ids only. */
export function logDeletionRequest(action: "requested" | "withdrawn" | "cleared", tenantId: string, userId: string) {
  logWarn("client.deletion_request", undefined, { action, tenantId, userId });
}

/**
 * The client asks for their account to be deleted. Asking again keeps the
 * first date. A client no longer active (or not theirs) is `not_found`.
 */
export async function requestDeletion(tenantId: string, clientUserId: string): Promise<DeletionRequest> {
  const [made] = await db
    .update(users)
    .set({ deletionRequestedAt: new Date() })
    .where(and(activeClient(tenantId, clientUserId), isNull(users.deletionRequestedAt)))
    .returning({ deletionRequestedAt: users.deletionRequestedAt });
  if (made) {
    logDeletionRequest("requested", tenantId, clientUserId);
    return { deletionRequestedAt: iso(made.deletionRequestedAt) };
  }
  const user = await db.query.users.findFirst({
    where: activeClient(tenantId, clientUserId),
    columns: { deletionRequestedAt: true },
  });
  if (!user) fail("not_found");
  return { deletionRequestedAt: iso(user.deletionRequestedAt) };
}

/** The client withdraws their request; withdrawing none is fine. */
export async function withdrawDeletion(tenantId: string, clientUserId: string): Promise<DeletionRequest> {
  const [withdrawn] = await db
    .update(users)
    .set({ deletionRequestedAt: null })
    .where(and(activeClient(tenantId, clientUserId), isNotNull(users.deletionRequestedAt)))
    .returning({ id: users.id });
  if (withdrawn) {
    logDeletionRequest("withdrawn", tenantId, clientUserId);
  } else {
    const user = await db.query.users.findFirst({ where: activeClient(tenantId, clientUserId), columns: { id: true } });
    if (!user) fail("not_found");
  }
  return { deletionRequestedAt: null };
}

/** Phones a client may get pushes on; registering another forgets the least recent. */
export const MAX_PUSH_TOKENS = 10;

/**
 * Body: { token, language? } — the phone's Expo push token and app language
 * (pushes are written in it; default "es"). A phone belongs to whoever
 * registered it last.
 */
export async function registerPushToken(
  tenantId: string,
  clientUserId: string,
  input: Record<string, unknown>,
) {
  const { token, language } = parse(pushTokenSchema, input);
  await db
    .insert(pushTokens)
    .values({ token, language, userId: clientUserId, tenantId })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { language, userId: clientUserId, tenantId, updatedAt: new Date() },
    });
  const stale = db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(eq(pushTokens.userId, clientUserId))
    .orderBy(desc(pushTokens.updatedAt))
    .offset(MAX_PUSH_TOKENS);
  await db.delete(pushTokens).where(inArray(pushTokens.token, stale));
  return { success: true };
}

/** Body: { token }. Called on sign-out; only removes the caller's own token. */
export async function removePushToken(
  tenantId: string,
  clientUserId: string,
  input: Record<string, unknown>,
) {
  const { token } = parse(pushTokenRemovalSchema, input);
  await db
    .delete(pushTokens)
    .where(
      and(
        eq(pushTokens.token, token),
        eq(pushTokens.userId, clientUserId),
        eq(pushTokens.tenantId, tenantId),
      ),
    );
  return { success: true };
}

/**
 * An error report the app sends (POST /api/mobile/client-error), an object:
 * its known texts as sent, those blank or not text left out, `fatal` only when
 * true. Never fails; the route cuts, scrubs and logs it.
 */
export function readErrorReport(body: object) {
  return parse(clientErrorReportSchema, body);
}
