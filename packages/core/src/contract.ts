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

export const DOCUMENT_CATEGORIES = ["contract", "plans", "certificates", "other"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/**
 * Largest PDF accepted. Uploads pass through our functions, whose request body
 * is capped at 4.5 MB by Vercel; this leaves room for the form overhead.
 */
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

/** A project document as listed by GET /api/mobile/documents. */
export type MobileDocument = {
  id: string;
  title: string;
  category: DocumentCategory;
  sizeBytes: number;
  /** ISO timestamp. */
  uploadedAt: string;
};

/** A project document as listed in the portal and by /api/v1. */
export type ProjectDocument = MobileDocument & { uploadedBy: string | null };

/** Error codes of the documents service (`{ error: code }` in the API). */
export type DocumentError =
  | "missing_fields"
  | "missing_file"
  | "invalid_category"
  | "invalid_file_type"
  | "file_too_large"
  | "project_not_found"
  | "not_found"
  | "forbidden";

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

/** Largest photo accepted; same body limit as documents. */
export const MAX_PHOTO_BYTES = MAX_DOCUMENT_BYTES;

/** Longer captions are cut to this length. */
export const MAX_CAPTION_LENGTH = 200;

/** A site photo as listed by GET /api/mobile/photos. */
export type MobilePhoto = {
  id: string;
  caption: string | null;
  sizeBytes: number;
  /** ISO timestamp. */
  uploadedAt: string;
};

/** A site photo as listed in the portal and by /api/v1. */
export type ProjectPhoto = MobilePhoto & { uploadedBy: string | null };

/** Error codes of the photos service (`{ error: code }` in the API). */
export type PhotoError =
  | "missing_file"
  | "invalid_file_type"
  | "file_too_large"
  | "project_not_found"
  | "not_found"
  | "forbidden";
