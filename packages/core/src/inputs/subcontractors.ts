import { z } from "zod";
import { isCalendarDate } from "../calendar";
import {
  BUDGET_CHAPTER_CODES,
  CONTRACT_TYPES,
  MACHINERY,
  PPE_ITEMS,
  PREVENTION_MODES,
  SUBCONTRACTOR_KINDS,
  SUBCONTRACTOR_TRADES,
  WORKER_ACCESS_FILTERS,
  WORKER_CATEGORIES,
  WORKER_ROLES,
  normalizeIdNumber,
  requirement,
} from "../contract";
import { EMAIL_PATTERN, MAX_TEXT } from "../input";
import { clippedOrNull, clippedText, optionalPhone } from "./fields";

// The bodies of Subcontratas (../subcontractors, ../subcontractor-workers):
// companies, their workers, documents and obra assignments. They come as JSON
// (the API, the portal's wizard) or form values (strings), so every block
// takes both, as before: texts are trimmed and cut at MAX_TEXT, a flag is
// true / "true" / "on" / "1", a number may be a numeric string.
//
// The order of the checks is the old one: what the service checks across
// fields or against the database (what is missing, the CIF/NIF/NIE's check
// digits and the postal code: ../subcontractor-rules; how the staff and the
// chain relate; the worker's company) comes between reads of the body in
// parts, each part in the order the old code read it, the whole one last.

// ─── Blocks ──────────────────────────────────────────────────────────────────

/** Trimmed, cut at MAX_TEXT; "" when not text. Never fails. */
const str = clippedText(MAX_TEXT);
/** Trimmed, cut at MAX_TEXT; null when blank. Never fails. */
const optional = clippedOrNull(MAX_TEXT);

/** A checkbox: true, "true", "on" or "1"; anything else is false. */
const flag = z
  .custom<boolean | string>()
  .optional()
  .transform((value) => value === true || value === "true" || value === "on" || value === "1");

/** A whole number from 0 to a million (or its digits), null when missing or ""; else `invalid_number`. */
const count = z
  .custom<number | string | null>()
  .optional()
  .transform((value, ctx): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
      ctx.issues.push({ code: "custom", message: "invalid_number", input: value });
      return z.NEVER;
    }
    return n;
  });

/** YYYY-MM-DD, null when blank; else `invalid_date`. */
const date = optional.refine((day) => day === null || isCalendarDate(day), { error: "invalid_date" });

/** One of `values`, null when blank; else `invalid_option`. */
const choice = <const T extends readonly string[]>(values: T) =>
  optional
    .refine((value) => value === null || values.includes(value), { error: "invalid_option" })
    .transform((value) => value as T[number] | null);

/** Some of `values`, as a list or comma-separated, each once (blanks dropped); any other is `invalid_option`. */
const someOf = <const T extends readonly string[]>(values: T) =>
  z
    .custom<string[] | string>()
    .optional()
    .transform((value) => {
      const items: unknown[] = Array.isArray(value) ? value : typeof value === "string" && value ? value.split(",") : [];
      return [...new Set(items.map((item) => str.parse(item)).filter(Boolean))];
    })
    .refine((list) => list.every((item) => values.includes(item)), { error: "invalid_option" })
    .transform((list) => list as T[number][]);

/** A DNI/NIE, CIF or TPC number as written in the register: cut, trimmed, spaces and dashes out, uppercase. */
const idNumber = str.transform(normalizeIdNumber);

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

// ─── Companies ───────────────────────────────────────────────────────────────

const companyIdentity = {
  kind: choice(SUBCONTRACTOR_KINDS),
  legalName: str,
  taxId: idNumber,
  address: str,
  postalCode: str,
  city: str,
};

/** A company's identity, read first: then `missing_fields`, `invalid_tax_id` and `invalid_postal_code` are checked. */
export const companyIdentitySchema = z.object(companyIdentity);

const companyStaff = {
  email: optional
    .transform((email) => email?.toLowerCase() ?? null)
    .refine((email) => email === null || EMAIL_PATTERN.test(email), { error: "invalid_email" }),
  headcount: count,
  permanentCount: count,
  subcontractsFurther: flag,
  suppliesOnly: flag,
};

/** Its email and staff, read next: then `permanent_exceeds_headcount` and `self_employed_cannot_subcontract`. */
export const companyStaffSchema = z.object(companyStaff);

/** Its level in the chain of subcontracts (1 when missing), read next: then `chain_too_deep`. */
export const companyChainSchema = z.object({ chainLevel: count });

/** A company, whole (an update sends it merged over the stored one), read last. */
export const companySchema = z.object({
  ...companyIdentity,
  ...companyStaff,
  ...companyChainSchema.shape,
  isInstaller: flag,
  province: str,
  reaNumber: optional,
  phone: optionalPhone,
  legalRep: optional,
  siteContact: optional,
  siteContactPhone: optionalPhone,
  trades: someOf(SUBCONTRACTOR_TRADES),
  installerReg: optional,
  preventionMode: choice(PREVENTION_MODES),
  preventionEntity: optional,
  preventionValidUntil: date,
  machinery: someOf(MACHINERY),
});

/** An optional company document that doesn't apply, and why. */
export const notApplicableSchema = z.object({
  requirementId: str.transform((id, ctx) => {
    const req = requirement(id);
    if (!req) ctx.issues.push({ code: "custom", message: "invalid_requirement", input: id });
    else if (req.mandatory || req.scope !== "company") ctx.issues.push({ code: "custom", message: "not_optional", input: id });
    else return req.id;
    return z.NEVER;
  }),
  reason: str.refine((reason) => reason !== "", { error: "missing_reason" }),
});

/**
 * What the registration wizard sends besides the company: an obra to put it
 * on (an object, else none) and the optional documents that don't apply (a
 * list; entries that aren't objects are skipped). Each is read where the
 * service gets to it, after the company and its obra.
 */
export const companyExtrasSchema = z.object({
  assignment: z
    .custom<Record<string, unknown>>()
    .optional()
    .transform((value) => (isObject(value) ? value : null)),
  notApplicable: z
    .custom<unknown[]>()
    .optional()
    .transform((value) => (Array.isArray(value) ? value.filter(isObject) : null)),
});

// ─── Documents ───────────────────────────────────────────────────────────────

/** A known requirement's template entry; else `invalid_requirement`. */
const requirementOf = str.transform((id, ctx) => {
  const req = requirement(id);
  if (req) return req;
  ctx.issues.push({ code: "custom", message: "invalid_requirement", input: id });
  return z.NEVER;
});

/** Whose document: the requirement, and the worker or the obra its scope needs (the service's check). */
export const documentOwnerSchema = z.object({ requirementId: requirementOf, workerId: str, projectId: str });

/** A version's dates, both optional (the requirement's validity may need the expiry: the service's check). */
export const versionDatesSchema = z.object({ issuedAt: date, expiresAt: date });

/** Documents asked for: a list of requirements, else the one `requirementId`; for a worker or an obra like an upload. */
export const documentRequestSchema = z.object({
  requirementIds: z
    .custom<string[]>()
    .optional()
    .transform((value) => (Array.isArray(value) ? (value as unknown[]) : null)),
  requirementId: z.custom<string>().optional(),
});

/** Why a version is rejected: told to the company; blank is `missing_reason`. */
export const rejectionSchema = z.object({ reason: str.refine((reason) => reason !== "", { error: "missing_reason" }) });

// ─── Obra assignments ────────────────────────────────────────────────────────

/** Budget chapter codes, a list or comma-separated; any other is `invalid_chapter`. */
const chapterCodes = z
  .custom<string[] | string>()
  .optional()
  .transform((value) => (Array.isArray(value) ? value.map((code) => str.parse(code)) : str.parse(value).split(",").filter(Boolean)))
  .refine((codes) => codes.every((code) => BUDGET_CHAPTER_CODES.includes(code)), { error: "invalid_chapter" })
  .transform((codes) => [...new Set(codes)].sort());

/** What a company does on an obra; the planned end not before its start is the service's check. */
export const assignmentSchema = z.object({
  chapterCodes,
  plannedStart: date,
  plannedEnd: date,
  bookOrder: count,
  bookDate: date,
  cssInformed: flag,
});

/** The obra the wizard puts a new company on. */
export const assignmentTargetSchema = z.object({ projectId: str });

// ─── Workers ─────────────────────────────────────────────────────────────────

const SS_PATTERN = /^[0-9][0-9 /-]{9,15}$/;

const workerIdentity = { subcontractorId: str, firstName: str, surnames: str, idDocument: idNumber };

/** A worker's identity, read first: then `missing_fields`, `invalid_id_document` and their company are checked. */
export const workerIdentitySchema = z.object(workerIdentity);

/** A worker, whole (an update sends it merged over the stored one). */
export const workerSchema = z.object({
  ...workerIdentity,
  ssNumber: optional.refine((number) => number === null || SS_PATTERN.test(number), { error: "invalid_number" }),
  phone: optionalPhone,
  category: choice(WORKER_CATEGORIES),
  trade: choice(SUBCONTRACTOR_TRADES),
  contractType: choice(CONTRACT_TYPES),
  startDate: date,
  tpcNumber: idNumber.transform((tpc) => tpc || null),
  roles: someOf(WORKER_ROLES),
  ppeItems: someOf(PPE_ITEMS),
});

/** "Comprobar acceso": a DNI/NIE or TPC number (blank is `missing_fields`), on one obra or anywhere. */
export const accessCheckSchema = z.object({
  query: idNumber.refine((query) => query !== "", { error: "missing_fields" }),
  projectId: optional,
});

/** A filter as a URL carries it: trimmed text, "" when not text. */
const filterText = z
  .custom<string>()
  .optional()
  .transform((value) => (typeof value === "string" ? value.trim() : ""));

/** The workers list's filters (paging is ../paging's): access "all" when missing or ""; else one of the filters or `invalid_option`. */
export const workerListSchema = z.object({
  access: z
    .custom<string>()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === "") return "all";
      const access = WORKER_ACCESS_FILTERS.find((filter) => filter === value);
      if (access) return access;
      ctx.issues.push({ code: "custom", message: "invalid_option", input: value });
      return z.NEVER;
    }),
  companyId: filterText,
  q: filterText,
  projectId: filterText,
});

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** PUT /api/v1/subcontractors/:id/assignments/:projectId, assignSubcontractorAction. */
export type AssignmentInput = z.input<typeof assignmentSchema>;
/** POST /api/v1/subcontractors/:id/documents/not-applicable, markNotApplicableAction. */
export type NotApplicableInput = z.input<typeof notApplicableSchema>;
/** POST /api/v1/subcontractors, createSubcontractorAction (the registration wizard). */
export type SubcontractorInput = z.input<typeof companySchema> & {
  assignment?: AssignmentInput & z.input<typeof assignmentTargetSchema>;
  notApplicable?: NotApplicableInput[];
};
/** PATCH /api/v1/subcontractors/:id, updateSubcontractorAction: any of the fields. */
export type SubcontractorChangesInput = Partial<z.input<typeof companySchema>>;
/** POST /api/v1/subcontractors/:id/documents (multipart), uploadSubcontractorDocumentAction. */
export type SubcontractorDocumentInput = z.input<typeof documentOwnerSchema> & z.input<typeof versionDatesSchema> & { file?: Blob };
/** POST /api/v1/subcontractors/:id/documents/request, requestSubcontractorDocumentsAction. */
export type DocumentRequestInput = z.input<typeof documentRequestSchema> & { workerId?: string; projectId?: string };
/** POST /api/v1/subcontractors/:id/documents/:documentId/reject. */
export type DocumentRejectionInput = z.input<typeof rejectionSchema>;
/** POST /api/v1/subcontractors/workers, createWorkerAction. */
export type WorkerInput = z.input<typeof workerSchema>;
/** PATCH /api/v1/subcontractors/workers/:workerId, updateWorkerAction: any of the fields. */
export type WorkerChangesInput = Partial<z.input<typeof workerSchema>>;
/** GET /api/v1/subcontractors/workers/check, checkWorkerAccessAction. */
export type AccessCheckInput = z.input<typeof accessCheckSchema>;
