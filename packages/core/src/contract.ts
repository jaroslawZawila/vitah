// Types and constants shared with clients (mobile app, browser components).
// Must not import server-only code: importing this file never pulls in the
// database.

export const MIN_PASSWORD_LENGTH = 8;

/** Project data exposed to the mobile app. Dates are calendar dates (YYYY-MM-DD). */
export type MobileProject = {
  id: string;
  ref: string;
  address: string;
  startDate: string | null;
  completionDate: string | null;
};

export type ProjectClientError =
  | "missing_fields"
  | "project_not_found"
  | "client_not_found"
  | "client_already_attached"
  | "client_has_project"
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
};

/** Error codes of the clients service (`{ error: code }` in the API). */
export type ClientError =
  | "missing_fields"
  | "invalid_email"
  | "invalid_date_of_birth"
  | "invalid_phone"
  | "password_too_short"
  | "email_exists"
  | "not_found"
  | "forbidden";

/** Response of POST /api/mobile/auth. */
export type MobileSession = {
  token: string;
  user: { id: string; email: string; name: string | null; tenantId: string };
};
