import { z } from "zod";
import { EMAIL_PATTERN, MAX_TEXT } from "../input";
import { clippedOrNull, id, optionalPhone, orNull, required } from "./fields";

// The bodies of the client app's contact data (../contact): a project's site
// manager and the builder's office.

/** A project's site manager: a staff user's id, or null (or "") to have none. Missing: `missing_fields`. */
export const siteManagerSchema = z.object({ userId: required(orNull(id)) });

/** An email, trimmed and cut like the other fields, null when blank; else `invalid_email`. */
const optionalEmail = clippedOrNull(MAX_TEXT).refine((email) => email === null || EMAIL_PATTERN.test(email), {
  error: "invalid_email",
});

/** The office, whole (a PUT): each field trimmed, null when blank or not sent. */
export const officeContactSchema = z.object({
  address: clippedOrNull(MAX_TEXT),
  phone: optionalPhone,
  email: optionalEmail,
  hours: clippedOrNull(MAX_TEXT),
});

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** PUT /api/v1/projects/:id/site-manager, setSiteManagerAction. */
export type SiteManagerInput = z.input<typeof siteManagerSchema>;
/** PUT /api/v1/tenant/contact, updateOfficeContactAction. */
export type OfficeContactInput = z.input<typeof officeContactSchema>;
