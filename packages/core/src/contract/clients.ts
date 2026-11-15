// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

/**
 * A project of the client, as the mobile app shows it (GET /api/mobile/project
 * and /api/mobile/projects). Dates are calendar dates (YYYY-MM-DD).
 */
export type MobileProject = {
  id: string;
  ref: string;
  address: string;
  /** The works' start and handover the client is told: the approved Planning baseline's, else the project's dates. */
  startDate: string | null;
  completionDate: string | null;
  /** Stage 8: the home has been handed over. */
  handedOver: boolean;
  /** The works' progress while they're under way (stages 6–7), else null. */
  progressPct: number | null;
};

/** The parts of the app that reload on their own when staff change them. */
export const CHANGE_AREAS = ["project", "obra", "photos", "documents"] as const;
export type ChangeArea = (typeof CHANGE_AREAS)[number];

/**
 * GET /api/mobile/changes: a counter per part of the app for the client's
 * project. The open app polls it and reloads a part when its counter moves.
 */
export type MobileChanges = { projectId: string } & Record<ChangeArea, number>;

/**
 * GET /api/mobile/changes (`?projectId=`): the counters of that project (else
 * the default one), and `projects`, a key that moves when the client's
 * project list changes (one added or removed, or what the list shows).
 */
export type MobileChangesReply = { changes: MobileChanges | null; projects: string };

export type ProjectClientError =
  | "missing_fields"
  | "project_not_found"
  | "client_not_found"
  | "client_already_attached"
  | "no_client"
  | "forbidden";

/** A client offered when picking a project's client. */
export type ClientOption = { id: string; name: string | null; email: string };

/** A mobile-app client as listed in the portal and by GET /api/v1/clients. */
export type ClientListItem = {
  id: string;
  email: string;
  // Null for clients created before profiles existed.
  firstName: string | null;
  surnames: string | null;
  /** Calendar date, YYYY-MM-DD. */
  dateOfBirth: string | null;
  address: string | null;
  phone: string | null;
  active: boolean;
  /** ISO timestamp. */
  createdAt: string;
  /** When the client asked in the app for their account to be deleted (ISO), else null. */
  deletionRequestedAt: string | null;
};

/** Error codes of the clients service (`{ error: code }` in the API). */
export type ClientError =
  | "missing_fields"
  | "invalid_email"
  | "invalid_date_of_birth"
  | "invalid_phone"
  | "weak_password"
  | "email_exists"
  | "not_found"
  | "forbidden";

/** Response of POST /api/mobile/auth. */
export type MobileSession = {
  token: string;
  user: { id: string; email: string; name: string | null; tenantId: string };
};

// ─── Client account (app Perfil tab) ─────────────────────────────────────────

export const APP_LANGUAGES = ["es", "en"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];
/** Also the portal's languages: each staff user picks theirs. */
export const isAppLanguage = (value: unknown): value is AppLanguage =>
  APP_LANGUAGES.includes(value as AppLanguage);

/** Which push notifications a client wants. */
export type NotificationPrefs = {
  /** New site photos. */
  progress: boolean;
  /** New documents. */
  documents: boolean;
  /** Messages from the team (nothing sends these yet). */
  messages: boolean;
};

/** GET/PUT /api/mobile/settings. (The language belongs to the phone: see /push-token.) */
export type MobileSettings = {
  notifications: NotificationPrefs;
  /** When the client asked for their account to be deleted (ISO), else null. Missing from older servers. */
  deletionRequestedAt?: string | null;
};

/**
 * POST / DELETE /api/mobile/account/deletion-request: the client's request
 * for their account to be deleted, after asking (the first date is kept) or
 * withdrawing (null). Only a request: the builder handles it.
 */
export type DeletionRequest = { deletionRequestedAt: string | null };

/** Error codes of the client account service (`{ error: code }` in the API). */
export type AccountError =
  | "missing_fields"
  | "wrong_password"
  | "too_many_attempts"
  | "weak_password"
  | "invalid_settings"
  | "invalid_token"
  | "not_found";
