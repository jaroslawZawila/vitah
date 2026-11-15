import { z } from "zod";
import { isCalendarDate } from "../calendar";
import { isStrongPassword } from "../contract";
import { invalid } from "../errors";
import { MAX_TEXT, PHONE_PATTERN } from "../input";
import { MAX_AMOUNT_CENTS } from "../money";
import { todayInSpain } from "../obra-calc";

// ─── Input schemas: the convention and the building blocks ──────────────────
// Every body a core write takes is checked by a zod schema at the top of the
// core function, `const body = parse(fooSchema, input)`, placed after the
// checks the old code ran before reading the input (requireEditor, require*,
// a state check), so 403/404/409 keep their precedence.
// - Schemas live in src/inputs/<module>.ts: DB-free (zod, ./fields, ../contract
//   constants only), named `<thing>Schema`; one that depends on a stored kind
//   is a record of schemas by kind. Their caller-facing types are
//   `z.input<typeof fooSchema>`, named `<Thing>Input`, and ../contract
//   re-exports them with `export type` only: the app and the browser get the
//   types, never zod. Core functions keep taking the raw `Record<string, unknown>`.
// - Error codes: a field's code is its zod error message. The blocks below
//   carry the codes of the hand-written helpers they replace (obra-data's
//   requiredText/optionalText/integer/calendarDate/workDate/pick/orNull,
//   input.ts' text/clippedText); on a raw zod schema set `{ error: "<code>" }`
//   on the type and on every check. `parse` throws the first issue's code as a
//   400 CoreError (fields are checked in shape order: keep the order the old
//   code checked them in); an issue without a code is `invalid_input`.
// - Behaviour is the spec: the same input gives the same result and code as
//   before, and the existing tests pass unchanged. z.object drops unknown keys
//   (they were ignored before): never `.strict()`. A partial update makes every
//   field `.optional()` and applies `changesOf(body)`.
// - Checks that need the database or another field (a line of the order, a
//   sum, a date after another, unique ids) stay in code after parse, with fail().
// - Every money field is `cents(...)`, bounded by MAX_AMOUNT_CENTS (../money).
//   Responses are never validated at runtime: types only.
// ─────────────────────────────────────────────────────────────────────────────

/** A code as core's errors write them (snake_case); zod's own messages aren't. */
const CODE = /^[a-z][a-z0-9_]*$/;

function codeOf(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return "invalid_input";
  if (CODE.test(issue.message)) return issue.message;
  // No option matched: the code is the last option's (orNull puts the schema last).
  if (issue.code === "invalid_union") return codeOf(issue.errors.at(-1)?.[0]);
  return "invalid_input";
}

/** `input` read by `schema`, typed; else a 400 CoreError with the first failing field's code. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw invalid(codeOf(result.error.issues[0]));
}

/** The fields a partial update sent: those `parse` left undefined were not (nor is `undefined` a value to store). */
export function changesOf<T extends object>(body: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

/** What a create that takes an idempotency key accepts besides its fields (./idempotency reads it). */
export type WithIdempotencyKey = { idempotencyKey?: string };

// ─── Text ────────────────────────────────────────────────────────────────────

/** Trimmed, non-empty, at most `max` characters. Missing, not text or blank: `missing_fields`; longer: `invalid_input`. */
export const requiredText = (max: number) =>
  z.string({ error: "missing_fields" }).trim().min(1, { error: "missing_fields" }).max(max, { error: "invalid_input" });

/** Trimmed text, null when missing, null or blank. Not text or longer than `max`: `invalid_input`. */
export const optionalText = (max: number) =>
  z
    .string({ error: "invalid_input" })
    .trim()
    .max(max, { error: "invalid_input" })
    .transform((text) => text || null)
    .nullish()
    .transform((value) => value ?? null);

/** input.ts' `text`: trimmed, undefined when not text or blank; longer than `max` is `too_long`. */
export const text = (max: number) =>
  z
    .custom<string | null>()
    .optional()
    .transform((value, ctx) => {
      if (typeof value !== "string") return undefined;
      const trimmed = value.trim();
      if (trimmed.length > max) {
        ctx.issues.push({ code: "custom", message: "too_long", input: value });
        return z.NEVER;
      }
      return trimmed || undefined;
    });

/** input.ts' `clippedText`: trimmed and cut at `max` characters, "" when not text; never fails. */
export const clippedText = (max: number) =>
  z
    .custom<string | null>()
    .optional()
    .transform((value) => (typeof value === "string" ? value.trim().slice(0, max) : ""));

// ─── Numbers ─────────────────────────────────────────────────────────────────

/** An integer within [min, max]; anything else is `invalid_input`. */
export const integer = (min: number, max: number) =>
  z.int({ error: "invalid_input" }).min(min, { error: "invalid_input" }).max(max, { error: "invalid_input" });

/**
 * An amount in cents within [min, max] (default 0 to MAX_AMOUNT_CENTS; a
 * signed one from -MAX_AMOUNT_CENTS): `invalid_input` otherwise. Every money
 * field uses it, so none goes past what the database stores.
 */
export function cents(min = 0, max = MAX_AMOUNT_CENTS) {
  if (min < -MAX_AMOUNT_CENTS || max > MAX_AMOUNT_CENTS) throw new Error("cents() is bounded by ±MAX_AMOUNT_CENTS");
  return integer(min, max);
}

/** Basis points (1 % = 100) within [0, max]. */
export const basisPoints = (max: number) => integer(0, max);

/**
 * obra-data's `scaled`: a number within [0, max] with up to log10(factor)
 * decimals, stored × factor. Missing: `missing_fields`; else `invalid_input`.
 */
export const scaled = (max: number, factor: number) =>
  z
    .number({ error: (issue) => (issue.input === undefined ? "missing_fields" : "invalid_input") })
    .min(0, { error: "invalid_input" })
    .max(max, { error: "invalid_input" })
    .transform((value) => Math.round(value * factor));

/** A quantity within [0, max] stored in thousandths. */
export const thousandths = (max: number) => scaled(max, 1000);

// ─── Dates, ids, choices ─────────────────────────────────────────────────────

/** A calendar date, YYYY-MM-DD (a real one); `invalid_date` otherwise. */
export const calendarDate = z.string({ error: "invalid_date" }).refine(isCalendarDate, { error: "invalid_date" });

/** A day something happened: a calendar date not after today (in Spain); `invalid_date` otherwise. */
export const workDate = calendarDate.refine((date) => date <= todayInSpain(), { error: "invalid_date" });

/** A record's id (ids are text): any string; whether it exists is the service's check. Not text: `invalid_input`. */
export const id = z.string({ error: "invalid_input" });

/** One of `values` (an exported constant array of ../contract); `invalid_input` otherwise. */
export const oneOf = <const T extends readonly [string, ...string[]]>(values: T) => z.enum(values, { error: "invalid_input" });

/** Null when missing, null or ""; else as `schema` reads it (with its code). */
export const orNull = <S extends z.ZodType>(schema: S) =>
  z
    .union([z.literal("").transform(() => null), schema])
    .nullish()
    .transform((value) => value ?? null);

/** A field a schema refuses when present (e.g. a due date on a credit note): `invalid_input`. */
export const refused = z.never({ error: "invalid_input" }).optional();

/**
 * An uploaded file, as the adapters pass it (a Blob from multipart). Typing
 * only: the service checks it after parse (requirePdf, …) with its own codes.
 */
export const uploadedFile = z.custom<Blob | null>().optional();

// ─── Required fields and blank texts ──────────────────────────────────────────

/** `schema`, but a missing value is `code` (default `missing_fields`) instead of the schema's own code. */
export const required = <S extends z.ZodType>(schema: S, code = "missing_fields") =>
  z.custom<z.input<S>>((value) => value !== undefined, { error: code }).pipe(schema as z.ZodType<z.output<S>, z.input<S>>);

/** obra-data's `optionalText(…) ?? ""`: trimmed text, "" when missing, null or blank; not text or longer than `max`: `invalid_input`. */
export const textOrBlank = (max: number) => optionalText(max).transform((text) => text ?? "");

/**
 * Like `required`, for a field whose blank also counts as missing: missing or "" is
 * `missing_fields`; anything else as `schema` reads it (with its code), e.g.
 * `present(oneOf(KINDS))`: null or "x" is `invalid_input`.
 */
export const present = <S extends z.ZodType>(schema: S) =>
  z
    .custom<z.input<S>>()
    .refine((value) => value !== undefined && value !== "", { error: "missing_fields" })
    .pipe(schema as z.ZodType<z.output<S>, z.input<S>>);

// ─── Accounts and contact fields ─────────────────────────────────────────────

/**
 * A text sent as is (a password, a code, an email to sign in with: never
 * trimmed nor cut), undefined when it isn't text. Never fails: the caller
 * decides what a missing one means, in its own order.
 */
export const sentText = z
  .custom<string>()
  .optional()
  .transform((value) => (typeof value === "string" ? value : undefined));

/** A password being set (anyone's), not trimmed, under the one policy (isStrongPassword); else `weak_password`. Stored ones are never re-checked. */
export const strongPassword = z.string({ error: "weak_password" }).refine(isStrongPassword, { error: "weak_password" });

/** clippedText, null when blank (the forms' optional texts). Never fails. */
export const clippedOrNull = (max: number) => clippedText(max).transform((text) => text || null);

/** A phone as staff type it (PHONE_PATTERN), trimmed and cut at MAX_TEXT, null when blank; else `invalid_phone`. */
export const optionalPhone = clippedOrNull(MAX_TEXT).refine((phone) => phone === null || PHONE_PATTERN.test(phone), {
  error: "invalid_phone",
});
