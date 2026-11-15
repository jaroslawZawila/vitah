import { z } from "zod";
import { fromCalendarDate, isCalendarDate } from "../calendar";
import { BUDGET_INPUTS, DOCUMENT_CATEGORIES, MAX_CAPTION_LENGTH, MAX_CHAPTER_CODE } from "../contract";
import { MAX_TEXT } from "../input";
import { clippedText, text, workDate } from "./fields";

// The bodies of a project's own writes: the project (../projects), its
// documents and budget inputs (../documents) and its photos (../photos).
// What needs the stored file or the database (a PDF's content, an upload's
// size, the project) is checked by the service, after parse.

const MAX_REF = 40;
const MAX_ADDRESS = 300;

// ─── Projects ────────────────────────────────────────────────────────────────

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * A project's date: YYYY-MM-DD, stored at UTC midnight; a full ISO timestamp
 * (which /api/v1 accepted before) counts as its UTC date. Undefined: not sent;
 * null or blank: cleared. Anything else is `invalid_date`.
 */
const projectDate = z
  .custom<string | null>()
  .optional()
  .transform((value, ctx): Date | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = typeof value === "string" ? value.trim() : undefined;
    if (trimmed === "") return null;
    const parsed = trimmed !== undefined && ISO_TIMESTAMP.test(trimmed) ? new Date(trimmed) : null;
    const raw =
      parsed && !Number.isNaN(parsed.getTime()) && isCalendarDate(trimmed!.slice(0, 10)) ? parsed.toISOString().slice(0, 10) : trimmed;
    if (raw === undefined || !isCalendarDate(raw)) {
      ctx.issues.push({ code: "custom", message: "invalid_date", input: value });
      return z.NEVER;
    }
    return fromCalendarDate(raw);
  });

/** A new project's ref and address, read first: either missing is `missing_fields`, checked before the dates. */
export const projectNamesSchema = z.object({ ref: text(MAX_REF), address: text(MAX_ADDRESS) });

/** Its dates, read next: then their order is checked, before the client. */
export const projectDatesSchema = z.object({ startDate: projectDate, completionDate: projectDate });

/** A new project, whole: dates as YYYY-MM-DD; `clientId` (admin only) an existing, free client. */
export const projectSchema = projectNamesSchema.extend({ ...projectDatesSchema.shape, clientId: text(MAX_TEXT) });

/** A project's changes, each optional: an address sent can't be blank (`missing_fields`), a blank date clears it. */
export const projectChangesSchema = z.object({
  address: text(MAX_ADDRESS)
    .pipe(z.string({ error: "missing_fields" }))
    .optional(),
  startDate: projectDate,
  completionDate: projectDate,
});

// ─── Documents ───────────────────────────────────────────────────────────────

/** A file that came with the form, not empty; else `missing_file`. Whether it is a PDF the service checks. */
const sentFile = z.custom<Blob>((file) => file instanceof Blob && file.size > 0, { error: "missing_file" });

/** One of the categories; else `invalid_category`. */
const documentCategory = z.enum(DOCUMENT_CATEGORIES, { error: "invalid_category" });
const budgetInput = z.enum(BUDGET_INPUTS, { error: "invalid_category" });

/** A new document (multipart): the file, a title (cut to size), its category. */
export const documentSchema = z.object({
  file: sentFile,
  title: clippedText(MAX_CAPTION_LENGTH).refine((title) => title !== "", { error: "missing_fields" }),
  category: documentCategory,
});

/** Shown in the client's app or hidden: a boolean, else `missing_fields`. */
export const visibilitySchema = z.object({ visibleToClient: z.boolean({ error: "missing_fields" }) });

/**
 * A budget input the browser uploaded straight to the store: where
 * (`budgetInputUpload` gave the pathname), as which input, its file's name and
 * an optional title (the name without its extension otherwise).
 */
export const budgetInputSchema = z.object({
  pathname: z.string({ error: "missing_fields" }),
  filename: clippedText(MAX_CAPTION_LENGTH).refine((name) => name !== "", { error: "missing_fields" }),
  budgetInput,
  title: clippedText(MAX_CAPTION_LENGTH),
});

/** A document already on the project used as one of its budget's inputs. */
export const budgetInputMarkSchema = z.object({ budgetInput });

// ─── Photos ──────────────────────────────────────────────────────────────────

/**
 * A new photo (multipart): caption and chapter code cut to size, the day it
 * was taken (not after today; none when missing or empty). The file is the
 * service's check, after these.
 */
export const photoSchema = z.object({
  caption: clippedText(MAX_CAPTION_LENGTH),
  chapterCode: clippedText(MAX_CHAPTER_CODE),
  takenOn: z
    .custom<string>()
    .optional()
    .transform((day) => day || null)
    .pipe(workDate.nullable()),
  file: z.custom<Blob>().optional(),
});

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** POST /api/v1/projects, the new-project wizard (createProject). */
export type ProjectInput = z.input<typeof projectSchema>;
/** PATCH /api/v1/projects/:id, updateProject. */
export type ProjectChangesInput = z.input<typeof projectChangesSchema>;
/** POST /api/v1/projects/:id/documents (multipart), addProjectDocumentAction. */
export type ProjectDocumentInput = z.input<typeof documentSchema>;
/** PATCH /api/v1/projects/:id/documents/:documentId and …/photos/:photoId. */
export type VisibilityInput = z.input<typeof visibilitySchema>;
/** POST /api/v1/projects/:id/documents/register, registerBudgetInputAction. */
export type BudgetInputRegistrationInput = z.input<typeof budgetInputSchema>;
/** POST /api/v1/projects/:id/photos (multipart), addProjectPhotoAction. */
export type ProjectPhotoInput = z.input<typeof photoSchema>;
