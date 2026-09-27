import bcrypt from "bcryptjs";
import {
  and,
  clientSettings,
  db,
  desc,
  eq,
  inArray,
  isClientUser,
  pushTokens,
  users,
} from "@repo/db";
import { replacePassword } from "./accounts";
import {
  APP_LANGUAGES,
  isStrongPassword,
  type AccountError,
  type AppLanguage,
  type MobileSettings,
} from "./contract";
import { CoreError } from "./errors";
import { clearAttempts, overLimit } from "./throttle";

// ─── Client account ──────────────────────────────────────────────────────────
// What a signed-in client manages themselves in the app's Perfil tab: their
// password and notifications, and the phones that get pushes.
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

const clientUser = (tenantId: string, clientUserId: string) =>
  and(eq(users.id, clientUserId), eq(users.tenantId, tenantId), isClientUser);

/** Wrong current passwords a client may enter per throttle window. */
const PASSWORD_ATTEMPTS = 10;

/**
 * Body: { currentPassword, newPassword }. The new one must pass `isStrongPassword`.
 * Revokes the client's existing mobile tokens (`passwordChangedAt`): the
 * caller hands the app a fresh one.
 */
export async function changePassword(
  tenantId: string,
  clientUserId: string,
  input: Record<string, unknown>,
) {
  const { currentPassword, newPassword } = input;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword) {
    fail("missing_fields");
  }
  if (!isStrongPassword(newPassword)) fail("weak_password");

  const throttle = [{ key: `password:${clientUserId}`, limit: PASSWORD_ATTEMPTS }];
  if (await overLimit(throttle)) fail("too_many_attempts");

  const where = clientUser(tenantId, clientUserId);
  const user = await db.query.users.findFirst({ where, columns: { passwordHash: true } });
  if (!user) fail("not_found");
  if (!user.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    fail("wrong_password");
  }
  await clearAttempts(throttle);

  await replacePassword(where, newPassword);
  return { success: true };
}

/** A client's settings; no settings row means these. */
export const DEFAULT_SETTINGS: MobileSettings = {
  notifications: { progress: true, documents: true, messages: true },
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

export async function getSettings(tenantId: string, clientUserId: string) {
  const row = await db.query.clientSettings.findFirst({
    where: and(eq(clientSettings.userId, clientUserId), eq(clientSettings.tenantId, tenantId)),
  });
  return settingsOf(row);
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
  const { notifications } = input;
  if (typeof notifications !== "object" || notifications === null) fail("invalid_settings");
  const changes: Partial<Record<(typeof COLUMNS)[keyof typeof COLUMNS], boolean>> = {};
  for (const [key, column] of Object.entries(COLUMNS)) {
    const value = (notifications as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") fail("invalid_settings");
    changes[column] = value;
  }

  const user = await db.query.users.findFirst({
    where: clientUser(tenantId, clientUserId),
    columns: { id: true },
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
  return settingsOf(row);
}

const isLanguage = (value: unknown): value is AppLanguage =>
  APP_LANGUAGES.includes(value as AppLanguage);

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]{1,200}\]$/;

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
  const { token, language = "es" } = input;
  if (typeof token !== "string" || !EXPO_TOKEN.test(token)) fail("invalid_token");
  if (!isLanguage(language)) fail("invalid_settings");
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
  const { token } = input;
  if (typeof token !== "string") fail("invalid_token");
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
