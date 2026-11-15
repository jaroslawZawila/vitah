import { z } from "zod";
import { isCalendarDate } from "../calendar";
import { APP_LANGUAGES } from "../contract";
import { MAX_TEXT } from "../input";
import { clippedOrNull, clippedText, optionalPhone, sentText, strongPassword } from "./fields";

// The bodies about the app's clients: creating one on the Clients tab
// (../clients), attaching one to a project (../project-client), and what the
// app itself sends (../client-account: notification settings and the phone's
// push token; /api/mobile/client-error: an error report). Installed app builds
// can't be updated: these answer exactly as before, code for code.

// ─── Clients (portal) ────────────────────────────────────────────────────────

/** The client's account, read first (never fails): what is missing, then the email, are checked after. */
const clientAccountFields = {
  firstName: clippedText(MAX_TEXT),
  surnames: clippedText(MAX_TEXT),
  // Trimmed and lowercased, never cut: a shortened email would be someone else's.
  email: sentText.transform((email) => email?.trim().toLowerCase() ?? ""),
};

/** A new client, read first: names and email, and whether a password came at all (any value). */
export const clientAccountSchema = z.object({ ...clientAccountFields, password: z.custom<string>().optional() });

/** A date of birth: a calendar date not in the future, null when blank; else `invalid_date_of_birth`. */
const dateOfBirth = clippedOrNull(MAX_TEXT).refine(
  (date) => date === null || (isCalendarDate(date) && Date.parse(`${date}T00:00:00Z`) <= Date.now()),
  { error: "invalid_date_of_birth" },
);

/** A new client, whole: the profile, then the password within the policy. */
export const clientSchema = z.object({
  ...clientAccountFields,
  dateOfBirth,
  address: clippedOrNull(MAX_TEXT),
  phone: optionalPhone,
  password: strongPassword,
});

/** A client attached to a project: one of the tenant's clients (trimmed); missing or blank: `missing_fields`. */
export const projectClientSchema = z.object({
  clientId: z.string({ error: "missing_fields" }).trim().min(1, { error: "missing_fields" }),
});

// ─── The app ─────────────────────────────────────────────────────────────────

const flag = z.boolean({ error: "invalid_settings" }).optional();

/**
 * The notification toggles sent: any of them, each a boolean. Any object is
 * taken (an array too: it sets nothing); anything else is `invalid_settings`.
 */
export const clientSettingsSchema = z.object({
  notifications: z
    .custom<{ progress?: boolean; documents?: boolean; messages?: boolean }>(
      (value) => typeof value === "object" && value !== null,
      { error: "invalid_settings" },
    )
    .transform((value) => (Array.isArray(value) ? {} : value))
    .pipe(z.object({ progress: flag, documents: flag, messages: flag })),
});

/** An Expo push token, as the phone's notifications library writes it. */
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]{1,200}\]$/;

/** A phone registered for pushes, in its app language ("es" when not sent). */
export const pushTokenSchema = z.object({
  token: z.string({ error: "invalid_token" }).regex(EXPO_TOKEN, { error: "invalid_token" }),
  language: z.enum(APP_LANGUAGES, { error: "invalid_settings" }).default("es"),
});

/** A phone that signed out: its token, as sent. */
export const pushTokenRemovalSchema = z.object({ token: z.string({ error: "invalid_token" }) });

/** A text of an error report: as sent when it has something besides spaces, else left out. */
const reported = sentText.transform((value) => (value?.trim() ? value : undefined));

/**
 * An error the app reports (POST /api/mobile/client-error): its known fields,
 * anything else dropped. Never fails on an object: the route cuts each text to
 * its size, scrubs it, and refuses a report without a message.
 */
export const clientErrorReportSchema = z.object({
  message: reported,
  stack: reported,
  screen: reported,
  fatal: z
    .custom<boolean>()
    .optional()
    .transform((value) => value === true),
  appVersion: reported,
  platform: reported,
  osVersion: reported,
  locale: reported,
});

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** POST /api/v1/clients, createClientAction. */
export type ClientInput = z.input<typeof clientSchema>;
/** assignProjectClientAction (portal only). */
export type ProjectClientInput = z.input<typeof projectClientSchema>;
/** PUT /api/mobile/settings. */
export type ClientSettingsInput = z.input<typeof clientSettingsSchema>;
/** POST /api/mobile/push-token. */
export type PushTokenInput = z.input<typeof pushTokenSchema>;
/** DELETE /api/mobile/push-token. */
export type PushTokenRemovalInput = z.input<typeof pushTokenRemovalSchema>;
/** POST /api/mobile/client-error. */
export type ClientErrorReportInput = z.input<typeof clientErrorReportSchema>;
