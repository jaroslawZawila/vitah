// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

import type { BudgetPdfKind } from "./budget";

export const DOCUMENT_CATEGORIES = ["contract", "plans", "certificates", "other", "budget"] as const;
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

/** The documents a budget is generated from (TECH_DESIGN §6.3). */
export const BUDGET_INPUTS = ["plans", "basic", "execution", "measurements"] as const;
export type BudgetInput = (typeof BUDGET_INPUTS)[number];

/** Largest file uploaded straight to the store from the browser (budget inputs). */
export const MAX_DIRECT_UPLOAD_BYTES = 100 * 1024 * 1024;

/** File types a budget input may have: extension → stored MIME type. */
export const BUDGET_INPUT_EXTENSIONS: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // FIEBDC-3 measurements; there is no registered type.
  bc3: "application/octet-stream",
};

/** A project document as listed in the portal and by /api/v1. */
export type ProjectDocument = MobileDocument & {
  uploadedBy: string | null;
  visibleToClient: boolean;
  contentType: string;
  /** The uploaded file's name, when it isn't a PDF named after the title. */
  filename: string | null;
  /** Set on a document a budget was generated from. */
  budgetInput: BudgetInput | null;
  /** Set on the PDFs of an issued budget revision. */
  budgetPdf: BudgetPdfKind | null;
};

/** Error codes of the documents service (`{ error: code }` in the API). */
export type DocumentError =
  | "budget_document"
  /** Hiding a revision's PDF the client is asked to approve, or approved. */
  | "approval_document"
  | "generation_running"
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

/** Which file of a photo to fetch: the original, or a small copy for grids. */
export const PHOTO_SIZES = ["full", "thumb"] as const;
export type PhotoSize = (typeof PHOTO_SIZES)[number];

/** The query string asking a photo URL for `size`: "" or "?size=thumb". */
export const photoSizeQuery = (size: PhotoSize) => (size === "full" ? "" : `?size=${size}`);

/** Reads `?size=`; anything missing or unknown means the original. */
export const parsePhotoSize = (value: string | null): PhotoSize =>
  PHOTO_SIZES.find((size) => size === value) ?? "full";

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
export type ProjectPhoto = MobilePhoto & {
  uploadedBy: string | null;
  /** The budget chapter it shows, if any. */
  chapterCode: string | null;
  /** The day it was taken, YYYY-MM-DD: as staff set it, else its upload day. */
  takenOn: string;
  /** Whether the project's client sees it in the app. */
  visibleToClient: boolean;
};

/** Error codes of the photos service (`{ error: code }` in the API). */
export type PhotoError =
  | "missing_file"
  | "missing_fields"
  | "invalid_date"
  | "invalid_file_type"
  | "file_too_large"
  | "project_not_found"
  | "not_found"
  | "forbidden";
