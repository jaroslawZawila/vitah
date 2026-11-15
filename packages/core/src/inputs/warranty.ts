import { z } from "zod";
import { MAX_WARRANTY_ANSWER, MAX_WARRANTY_DESCRIPTION, STAFF_WARRANTY_STATUSES, WARRANTY_KINDS, WARRANTY_ROOMS } from "../contract";
import { calendarDate, oneOf, optionalText, orNull, present, requiredText, uploadedFile, type WithIdempotencyKey } from "./fields";

// The bodies of ../warranty's writes: a client's new claim and photo (from the
// app), and staff's answer. Whether the home is handed over, the caps and the
// claim's state are checked there, after parse.

/** A new claim, from the client: kind, room and description required; not urgent unless said. */
export const newClaimSchema = z.object({
  kind: present(oneOf(WARRANTY_KINDS)),
  room: present(oneOf(WARRANTY_ROOMS)),
  description: requiredText(MAX_WARRANTY_DESCRIPTION),
  urgent: z.boolean({ error: "invalid_input" }).default(false),
});

/** A claim's photo (multipart): the image; its type and size are the service's check. */
export const claimPhotoSchema = z.object({ file: uploadedFile });

/**
 * Staff's changes to a claim: its status, the visit day (null or "" clears
 * it) and the answer to the client (null or blank clears it). A field not sent
 * stays.
 */
export const claimChangesSchema = z.object({
  status: oneOf(STAFF_WARRANTY_STATUSES).optional(),
  visitOn: orNull(calendarDate).optional(),
  answer: optionalText(MAX_WARRANTY_ANSWER).optional(),
});

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** POST /api/mobile/warranty. */
export type WarrantyClaimInput = WithIdempotencyKey & z.input<typeof newClaimSchema>;
/** PATCH /api/v1/projects/:id/warranty/:claimId, updateClaimAction. */
export type WarrantyClaimChangesInput = z.input<typeof claimChangesSchema>;
