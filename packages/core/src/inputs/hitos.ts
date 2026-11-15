import { z } from "zod";
import { MAX_CHAPTER_CODE, type HitoFileKind } from "../contract";
import { basisPoints, calendarDate, cents, id, requiredText, textOrBlank, uploadedFile, workDate } from "./fields";

// The bodies of ../hitos' writes: the payment plan, a hito's checks, its acta
// photos and files, and its payment. Fields are in the order the service
// checked them before; what needs the project (its chapters, photos, the
// hito's price) is checked there, after parse.

const MAX_NAME = 120;
const MAX_TEXT = 2_000;
const MAX_CHECK = 300;

/** One hito's changes; `chapterCodes` replaces the chapters it closes (repeated codes count once). */
const hitoFields = {
  name: requiredText(MAX_NAME).optional(),
  pctBp: basisPoints(10_000).optional(),
  scope: textOrBlank(MAX_TEXT).optional(),
  billingMoment: textOrBlank(MAX_TEXT).optional(),
  chapterCodes: z.array(requiredText(MAX_CHAPTER_CODE), { error: "invalid_input" }).optional(),
};

export const hitoChangesSchema = z.object(hitoFields);
export type HitoChanges = z.output<typeof hitoChangesSchema>;

/** Several hitos at once, in turn. */
export const planSchema = z.object({
  hitos: z.array(z.object({ id, ...hitoFields }, { error: "invalid_input" }), { error: "missing_fields" }),
});

export const newCheckSchema = z.object({ label: requiredText(MAX_CHECK) });

export const checkChangesSchema = z.object({
  label: requiredText(MAX_CHECK).optional(),
  done: z.boolean({ error: "invalid_input" }).optional(),
});

/** The project photos of the acta fotográfica (the whole set; repeated ids count once). */
export const actaPhotosSchema = z.object({ photoIds: z.array(id, { error: "invalid_input" }) });

/**
 * An acta's or invoice's PDF (checked by the service first) and its date: the
 * day the acta was signed (required), the invoice's (today when missing or "").
 */
export const hitoFileSchemas = {
  acta: z.object({ file: uploadedFile, date: calendarDate }),
  invoice: z.object({ file: uploadedFile, date: z.union([z.literal(""), calendarDate]).optional() }),
} satisfies Record<HitoFileKind, z.ZodType>;

/** The day it was collected and the amount: the hito's price with VAT when missing or null. */
export const hitoPaymentSchema = z.object({ paidOn: workDate, amountCents: cents(1).nullish() });

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** PATCH /api/v1/projects/:id/hitos/:hitoId, updateHitoAction. */
export type HitoChangesInput = z.input<typeof hitoChangesSchema>;
/** PUT /api/v1/projects/:id/hitos, savePlanAction. */
export type HitoPlanInput = z.input<typeof planSchema>;
/** POST …/hitos/:hitoId/checks, addCheckAction. */
export type NewHitoCheckInput = z.input<typeof newCheckSchema>;
/** PATCH …/hitos/:hitoId/checks/:checkId, updateCheckAction. */
export type HitoCheckChangesInput = z.input<typeof checkChangesSchema>;
/** PUT …/hitos/:hitoId/photos, setActaPhotosAction. */
export type ActaPhotosInput = z.input<typeof actaPhotosSchema>;
/** PUT …/hitos/:hitoId/files/:kind (multipart), uploadHitoFileAction. */
export type HitoFileInput = z.input<(typeof hitoFileSchemas)[HitoFileKind]>;
/** PUT …/hitos/:hitoId/payment, registerPaymentAction. */
export type HitoPaymentInput = z.input<typeof hitoPaymentSchema>;
