import { z } from "zod";
import { ANNEX_KINDS, BUDGET_QUALITIES, MAX_CHAPTER_CODE, MAX_EXCLUSION_TEXT, OPTION_KINDS } from "../contract";
import {
  basisPoints,
  calendarDate,
  cents,
  id,
  integer,
  oneOf,
  optionalText,
  required,
  requiredText,
  scaled,
  textOrBlank,
  thousandths,
  uploadedFile,
  workDate,
} from "./fields";

// The bodies of the budget's writes: ../budget (revisions, chapters, lines,
// progress), ../budget-options, ../budget-issue and ../budget-generations.
// Fields are in the order the services checked them before; what needs the
// revision or the price base (a FRAMER chapter's fixed code, a base entry's
// defaults, the options chosen) is checked there, around parse.

export const MAX_NAME = 200;
const MAX_DESCRIPTION = 2_000;
const MAX_UNIT = 10;
const MAX_NOTE = 2_000;
const MAX_TEXT = 10_000;
const MAX_QUANTITY = 1_000_000;
const MAX_AREA_M2 = 1_000_000;
const MAX_UNIT_PRICE_CENTS = 100_000_000;
const MAX_BLOCKS = 50;
/** A budget's exclusion lines at most (its `texts.exclusions`). */
export const MAX_EXCLUSIONS = MAX_BLOCKS;
/** Ticked review checks kept on a revision (keys of checks hidden for now stay too). */
export const MAX_REVIEWED = 1_000;
const MAX_REVIEW_KEY = 80;

// ─── Revisions ───────────────────────────────────────────────────────────────

/** POST /budget: the first draft (Rev.0 unless `number` brings a budget in at a later revision). */
export const newBudgetSchema = z.object({ reference: optionalText(MAX_NAME), number: integer(0, 999).optional() });

/** Text as typed (not trimmed), at most `max` characters. */
const prose = (max = MAX_TEXT) => z.string({ error: "invalid_input" }).max(max, { error: "invalid_input" });
const entry = <S extends z.ZodRawShape>(shape: S) => z.object(shape, { error: "invalid_input" });
const list = <S extends z.ZodType>(item: S) =>
  z.array(item, { error: "invalid_input" }).max(MAX_BLOCKS, { error: "invalid_input" });
/**
 * A section of the texts, read key by key over the stored one: as before, an
 * array (an object to the old check) has none of its keys, so it changes nothing.
 * The fields come last: `parse` takes a failed union's code from its last option.
 */
const section = <S extends z.ZodRawShape>(shape: S) =>
  z.union([z.array(z.unknown()).transform(() => ({}) as Partial<z.output<z.ZodObject<S>>>), entry(shape)]);

/** A cover field. */
const MAX_SHORT_TEXT = 2_000;
/** A FRAMER revision's texts, partial: each section sent replaces (cover: merges into) the stored one. */
const textsSchema = entry({
  cover: section({
    promoter: prose(MAX_SHORT_TEXT).optional(),
    site: prose(MAX_SHORT_TEXT).optional(),
    cadastral: prose(MAX_SHORT_TEXT).optional(),
    surfaces: prose(MAX_SHORT_TEXT).optional(),
    program: prose(MAX_SHORT_TEXT).optional(),
    basis: prose(MAX_SHORT_TEXT).optional(),
    scope: prose(MAX_SHORT_TEXT).optional(),
    system: prose(MAX_SHORT_TEXT).optional(),
  }).optional(),
  justification: section({
    intro: prose().optional(),
    blocks: list(entry({ title: prose(MAX_NAME), text: prose() })).optional(),
  }).optional(),
  measurementCriterion: prose().optional(),
  annex: list(
    entry({
      kind: oneOf(ANNEX_KINDS),
      // A new item (or one without an id) gets one.
      id: z
        .custom<string>()
        .optional()
        .transform((value: unknown) => (typeof value === "string" && value ? value.slice(0, 40) : crypto.randomUUID())),
      title: prose(MAX_NAME),
      text: prose(),
    }),
  ).optional(),
  exclusions: list(prose(MAX_EXCLUSION_TEXT).transform((text) => text.trim()))
    .transform((items) => items.filter(Boolean))
    .optional(),
  includes: prose().optional(),
});

/** The texts sent, as ../budget merges them over the stored ones. */
export type TextsChanges = z.output<typeof textsSchema>;

/** The conditions, partial: those sent over the stored ones. */
const conditionsSchema = entry({
  validityDays: integer(1, 365).optional(),
  term: textOrBlank(MAX_NAME).optional(),
  signingPlace: textOrBlank(MAX_NAME).optional(),
});

/** An area in m², stored in hundredths; null clears it. */
const area = scaled(MAX_AREA_M2, 100).nullable();

/**
 * A draft's changes. The API names the areas in m² and the contingency and
 * margins in %; parse gives them in hundredths. `exclusions` is /api/v1's
 * one-per-line text; `review` the whole list of ticked checks, `reviewed` one.
 */
export const revisionChangesSchema = z.object({
  reference: optionalText(MAX_NAME).optional(),
  vatRateBp: basisPoints(10_000).optional(),
  quality: oneOf(BUDGET_QUALITIES).nullable().optional(),
  changeReason: optionalText(MAX_NOTE).optional(),
  builtAreaM2: area.optional(),
  usefulAreaM2: area.optional(),
  contingencyPct: scaled(50, 100).optional(),
  // Both margins are shares of the price, together below 100 % (checked in `updateRevision`).
  overheadPct: scaled(50, 100).optional(),
  profitPct: scaled(50, 100).optional(),
  texts: textsSchema.optional(),
  exclusions: optionalText(MAX_TEXT).optional(),
  conditions: conditionsSchema.optional(),
  // One "Gasto no incluido" ticked or not, merged with the stored list; `save` also keeps it in the tenant's
  // library; `replaces`: the budget's line it takes the place of (edited, or its library line renamed).
  exclusion: entry({
    text: requiredText(MAX_EXCLUSION_TEXT),
    included: z.boolean({ error: "invalid_input" }),
    save: z.boolean({ error: "invalid_input" }).optional(),
    replaces: z.string({ error: "invalid_input" }).max(MAX_EXCLUSION_TEXT, { error: "invalid_input" }).optional(),
  }).optional(),
  review: entry({
    done: z
      .array(z.string({ error: "invalid_input" }).max(MAX_REVIEW_KEY, { error: "invalid_input" }), { error: "invalid_input" })
      .max(MAX_REVIEWED, { error: "invalid_input" }),
  }).optional(),
  reviewed: entry({
    key: z.string({ error: "invalid_input" }).min(1, { error: "invalid_input" }).max(MAX_REVIEW_KEY, { error: "invalid_input" }),
    done: z.boolean({ error: "invalid_input" }),
  }).optional(),
});

/** Issuing a draft: today, the reason already typed, validity from the conditions and shared with the client unless given. */
export const issueSchema = z.object({
  changeReason: optionalText(MAX_NOTE).optional(),
  issuedOn: workDate.optional(),
  validUntil: calendarDate.optional(),
  // Shared unless it is exactly false.
  shareWithClient: z
    .custom<boolean>()
    .optional()
    .transform((value: unknown) => value !== false),
});

/** Accepting an issued revision: today unless given; `signed` (the client's signed copy) is checked by the service. */
export const acceptSchema = z.object({
  acceptedOn: workDate.optional(),
  acceptedBy: optionalText(MAX_NAME),
  chosenOptionIds: z.array(id, { error: "invalid_input" }).optional(),
  signed: uploadedFile,
});

/** The client turned it down: today unless given. */
export const rejectSchema = z.object({ rejectedOn: calendarDate.optional() });

// ─── Chapters and lines ──────────────────────────────────────────────────────

/** A chapter of a budget entered before the FRAMER model. */
export const newChapterSchema = z.object({
  code: requiredText(MAX_CHAPTER_CODE),
  name: requiredText(MAX_NAME),
  changeNote: optionalText(MAX_NOTE),
});

/** A chapter's changes (a FRAMER chapter keeps its code: the service checks that first). */
export const chapterChangesSchema = z.object({
  code: requiredText(MAX_CHAPTER_CODE).optional(),
  name: requiredText(MAX_NAME).optional(),
  changeNote: optionalText(MAX_NOTE).optional(),
  pdfNote: optionalText(MAX_NOTE).optional(),
});

/**
 * A line's fields, by the kind of its chapter: an option's line may have a
 * negative price (a deduction). `quantity` is stored in thousandths
 * (`quantityMilli`, which the API never takes).
 */
const lineFields = (minPriceCents: number) => ({
  code: requiredText(MAX_CHAPTER_CODE),
  description: requiredText(MAX_DESCRIPTION),
  unit: requiredText(MAX_UNIT),
  quantity: thousandths(MAX_QUANTITY),
  unitPriceCents: cents(minPriceCents, MAX_UNIT_PRICE_CENTS),
  note: optionalText(MAX_NOTE),
  source: oneOf(["base", "estimated", "manual"] as const),
});
const chapterLine = lineFields(0);
const optionLine = lineFields(-MAX_UNIT_PRICE_CENTS);

/** Read first: a price base entry gives a new line's defaults. */
export const lineBaseSchema = z.object({ baseCode: z.string({ error: "invalid_input" }).optional() });

const newLine = (fields: typeof chapterLine) =>
  z.object({ ...fields, unitPriceCents: required(fields.unitPriceCents), source: fields.source.optional() });

/** A new line, by its chapter's kind. */
export const newLineSchemas = { chapter: newLine(chapterLine), option: newLine(optionLine) };
/** A new line sent without a code, which its FRAMER chapter or the options' numbering gives it. */
export const numberedLineSchemas = {
  chapter: newLineSchemas.chapter.omit({ code: true }),
  option: newLineSchemas.option.omit({ code: true }),
};

const lineChanges = (fields: typeof chapterLine) => ({
  description: fields.description.optional(),
  unit: fields.unit.optional(),
  quantity: fields.quantity.optional(),
  unitPriceCents: fields.unitPriceCents.optional(),
  note: fields.note.optional(),
  source: fields.source.optional(),
  /** Moves the line to another chapter of the same revision. */
  chapterId: id.optional(),
});

/** A line's changes, by its chapter's kind: an option line's code follows its position (a code sent is ignored). */
export const lineChangesSchemas = {
  chapter: z.object({ code: chapterLine.code.optional(), ...lineChanges(chapterLine) }),
  option: z.object(lineChanges(optionLine)),
};

/** Each line's executed % (on the accepted revision). */
export const progressSchema = z.object({
  lines: z.array(entry({ id, executedPct: integer(0, 100) }), { error: "missing_fields" }),
});

// ─── Options ─────────────────────────────────────────────────────────────────

/** Read first: a price base entry starts the option (its line, and its name unless given). */
export const optionBaseSchema = z.object({ baseCode: z.coerce.string<string>().optional() });

const optionKind = oneOf(OPTION_KINDS);

export const newOptionSchema = z.object({
  name: requiredText(MAX_NAME),
  optionKind: optionKind.nullish().transform((kind) => kind ?? "extra"),
  /** The text printed under its title (`pdfNote`). */
  intro: optionalText(MAX_NOTE),
  replacesLine: optionalText(MAX_CHAPTER_CODE),
});

export const optionChangesSchema = z.object({
  name: requiredText(MAX_NAME).optional(),
  optionKind: optionKind.optional(),
  intro: optionalText(MAX_NOTE).optional(),
  replacesLine: optionalText(MAX_CHAPTER_CODE).optional(),
});

/** A chapter line offered as an option: the owner does it (`deduction`) or another solution replaces it. */
export const optionFromLineSchema = z.object({ kind: oneOf(["deduction", "alternative"] as const) });

// ─── The AI's first draft ────────────────────────────────────────────────────

export const generationSchema = z.object({
  documentIds: z.array(id, { error: "no_documents" }).min(1, { error: "no_documents" }),
  reference: optionalText(MAX_NAME),
  quality: oneOf(BUDGET_QUALITIES).default("framer"),
  vatRateBp: basisPoints(10_000).default(1000),
});

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** POST /api/v1/projects/:id/budget. */
export type NewBudgetInput = z.input<typeof newBudgetSchema>;
/** PATCH …/budget/revisions/:revisionId, updateRevisionAction. */
export type BudgetRevisionChangesInput = z.input<typeof revisionChangesSchema>;
/** POST …/revisions/:revisionId/issue, issueRevisionAction. */
export type IssueRevisionInput = z.input<typeof issueSchema>;
/** POST …/revisions/:revisionId/accept, acceptRevisionAction (a form). */
export type AcceptRevisionInput = z.input<typeof acceptSchema>;
/** POST …/revisions/:revisionId/reject, rejectRevisionAction. */
export type RejectRevisionInput = z.input<typeof rejectSchema>;
/** POST …/revisions/:revisionId/chapters. */
export type NewBudgetChapterInput = z.input<typeof newChapterSchema>;
/** PATCH …/budget/chapters/:chapterId, updateChapterAction. */
export type BudgetChapterChangesInput = z.input<typeof chapterChangesSchema>;
/** POST …/chapters/:chapterId/lines, addLineAction: with `baseCode` the rest defaults to the price base entry's. */
export type NewBudgetLineInput = z.input<typeof lineBaseSchema> & Partial<z.input<typeof newLineSchemas.option>>;
/** PATCH …/budget/lines/:lineId, updateLineAction (an option line's code is ignored). */
export type BudgetLineChangesInput = z.input<typeof lineChangesSchemas.chapter>;
/** PUT …/budget/progress, saveProgressAction. */
export type BudgetProgressInput = z.input<typeof progressSchema>;
/** POST …/revisions/:revisionId/options, addOptionAction: with `baseCode` the name defaults to the entry's. */
export type NewBudgetOptionInput = z.input<typeof optionBaseSchema> & Partial<z.input<typeof newOptionSchema>>;
/** PATCH …/budget/options/:optionId, updateOptionAction. */
export type BudgetOptionChangesInput = z.input<typeof optionChangesSchema>;
/** POST …/budget/lines/:lineId/option, optionFromLineAction. */
export type OptionFromLineInput = z.input<typeof optionFromLineSchema>;
/** POST …/budget/generations, startGenerationAction. */
export type BudgetGenerationInput = z.input<typeof generationSchema>;
