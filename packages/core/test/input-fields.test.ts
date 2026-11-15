import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CoreError } from "../src/errors";
import {
  basisPoints,
  calendarDate,
  cents,
  changesOf,
  clippedOrNull,
  clippedText,
  id,
  integer,
  oneOf,
  optionalPhone,
  optionalText,
  orNull,
  parse,
  present,
  refused,
  required,
  requiredText,
  scaled,
  sentText,
  strongPassword,
  text,
  textOrBlank,
  thousandths,
  workDate,
} from "../src/inputs/fields";
import { MAX_AMOUNT_CENTS } from "../src/money";

/** What `parse` makes of `value` as the field `schema`: its value, or the error's code. */
function read(schema: z.ZodType, value: unknown): { value: unknown } | { code: string } {
  try {
    return { value: parse(z.object({ field: schema }), value === ABSENT ? {} : { field: value }).field };
  } catch (error) {
    if (!(error instanceof CoreError)) throw error;
    expect(error.status).toBe(400);
    return { code: error.code };
  }
}
const ABSENT = Symbol("absent");
const ok = (value: unknown) => ({ value });
const code = (code: string) => ({ code });

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") }));
afterEach(() => vi.useRealTimers());

describe("parse", () => {
  it("returns the typed value, without the keys the schema doesn't name", () => {
    const schema = z.object({ name: requiredText(10) });
    expect(parse(schema, { name: " Ana ", tenantId: "other", extra: 1 })).toEqual({ name: "Ana" });
  });

  it("throws the first failing field's code, in the schema's order, as a 400", () => {
    const schema = z.object({ day: calendarDate, name: requiredText(10) });
    expect(() => parse(schema, { name: "", day: "nope" })).toThrow(expect.objectContaining({ code: "invalid_date", status: 400 }));
    expect(() => parse(schema, { day: "2026-10-01" })).toThrow(expect.objectContaining({ code: "missing_fields" }));
  });

  it("answers invalid_input for an issue without a code: zod's own messages, a body that isn't an object", () => {
    expect(() => parse(z.object({ n: z.number() }), { n: "1" })).toThrow(expect.objectContaining({ code: "invalid_input" }));
    expect(() => parse(z.object({}), null)).toThrow(expect.objectContaining({ code: "invalid_input" }));
    expect(() => parse(z.object({}), [])).toThrow(expect.objectContaining({ code: "invalid_input" }));
  });

  it("keeps a custom code set with { error }", () => {
    expect(() => parse(z.object({ n: z.number({ error: "too_many_pages" }) }), {})).toThrow(expect.objectContaining({ code: "too_many_pages" }));
  });
});

describe("text", () => {
  it("requiredText: trimmed; missing, not text or blank is missing_fields; too long is invalid_input", () => {
    expect(read(requiredText(5), "  hola ")).toEqual(ok("hola"));
    expect(read(requiredText(5), " abcde ")).toEqual(ok("abcde"));
    expect(read(requiredText(5), ABSENT)).toEqual(code("missing_fields"));
    expect(read(requiredText(5), null)).toEqual(code("missing_fields"));
    expect(read(requiredText(5), 7)).toEqual(code("missing_fields"));
    expect(read(requiredText(5), "   ")).toEqual(code("missing_fields"));
    expect(read(requiredText(5), "abcdef")).toEqual(code("invalid_input"));
  });

  it("optionalText: trimmed, null when missing, null or blank; not text or too long is invalid_input", () => {
    expect(read(optionalText(5), " hola ")).toEqual(ok("hola"));
    expect(read(optionalText(5), ABSENT)).toEqual(ok(null));
    expect(read(optionalText(5), null)).toEqual(ok(null));
    expect(read(optionalText(5), "  ")).toEqual(ok(null));
    expect(read(optionalText(5), 3)).toEqual(code("invalid_input"));
    expect(read(optionalText(5), "abcdef")).toEqual(code("invalid_input"));
  });

  it("text (input.ts): undefined when not text or blank; too long is too_long", () => {
    expect(read(text(5), " hola ")).toEqual(ok("hola"));
    expect(read(text(5), ABSENT)).toEqual(ok(undefined));
    expect(read(text(5), 3)).toEqual(ok(undefined));
    expect(read(text(5), " ")).toEqual(ok(undefined));
    expect(read(text(5), "abcdef")).toEqual(code("too_long"));
  });

  it("clippedText: trimmed and cut, \"\" when not text; never fails", () => {
    expect(read(clippedText(3), " abcdef ")).toEqual(ok("abc"));
    expect(read(clippedText(3), ABSENT)).toEqual(ok(""));
    expect(read(clippedText(3), 42)).toEqual(ok(""));
  });
});

describe("numbers", () => {
  it("integer: within the range; anything else is invalid_input", () => {
    expect(read(integer(1, 10), 10)).toEqual(ok(10));
    for (const bad of [0, 11, 1.5, "3", null, ABSENT, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(read(integer(1, 10), bad)).toEqual(code("invalid_input"));
    }
  });

  it("cents: bounded by MAX_AMOUNT_CENTS, and so is every range asked of it", () => {
    expect(MAX_AMOUNT_CENTS).toBe(2_000_000_000);
    expect(MAX_AMOUNT_CENTS).toBeLessThan(2 ** 31);
    expect(read(cents(), 0)).toEqual(ok(0));
    expect(read(cents(), MAX_AMOUNT_CENTS)).toEqual(ok(MAX_AMOUNT_CENTS));
    expect(read(cents(), MAX_AMOUNT_CENTS + 1)).toEqual(code("invalid_input"));
    expect(read(cents(), 2 ** 31)).toEqual(code("invalid_input"));
    expect(read(cents(), -1)).toEqual(code("invalid_input"));
    expect(read(cents(1), 0)).toEqual(code("invalid_input"));
    expect(read(cents(-MAX_AMOUNT_CENTS, -1), -MAX_AMOUNT_CENTS)).toEqual(ok(-MAX_AMOUNT_CENTS));
    expect(read(cents(-MAX_AMOUNT_CENTS, -1), -MAX_AMOUNT_CENTS - 1)).toEqual(code("invalid_input"));
    expect(read(cents(), 10.5)).toEqual(code("invalid_input"));
    expect(read(cents(), "100")).toEqual(code("invalid_input"));
    expect(() => cents(0, MAX_AMOUNT_CENTS + 1)).toThrow();
    expect(() => cents(-MAX_AMOUNT_CENTS - 1)).toThrow();
  });

  it("basisPoints: an integer from 0 to the maximum", () => {
    expect(read(basisPoints(2000), 2000)).toEqual(ok(2000));
    expect(read(basisPoints(2000), 2001)).toEqual(code("invalid_input"));
    expect(read(basisPoints(2000), -1)).toEqual(code("invalid_input"));
  });

  it("scaled and thousandths: stored × factor; missing is missing_fields, else invalid_input", () => {
    expect(read(thousandths(100), 12.3456)).toEqual(ok(12_346));
    expect(read(scaled(100, 100), 0.5)).toEqual(ok(50));
    expect(read(thousandths(100), ABSENT)).toEqual(code("missing_fields"));
    expect(read(thousandths(100), null)).toEqual(code("invalid_input"));
    expect(read(thousandths(100), -1)).toEqual(code("invalid_input"));
    expect(read(thousandths(100), 101)).toEqual(code("invalid_input"));
    expect(read(thousandths(100), "1")).toEqual(code("invalid_input"));
  });
});

describe("dates, ids, choices", () => {
  it("calendarDate: a real YYYY-MM-DD; anything else is invalid_date", () => {
    expect(read(calendarDate, "2027-02-28")).toEqual(ok("2027-02-28"));
    for (const bad of ["2026-02-31", "2026-1-01", "", 20261001, null, ABSENT]) {
      expect(read(calendarDate, bad)).toEqual(code("invalid_date"));
    }
  });

  it("workDate: not after today in Spain", () => {
    expect(read(workDate, "2026-10-19")).toEqual(ok("2026-10-19"));
    expect(read(workDate, "2026-10-20")).toEqual(code("invalid_date"));
    expect(read(workDate, "2026-13-01")).toEqual(code("invalid_date"));
    // Just after midnight in Madrid it is already the next day.
    vi.setSystemTime(new Date("2026-10-19T22:30:00Z"));
    expect(read(workDate, "2026-10-20")).toEqual(ok("2026-10-20"));
  });

  it("id: any text; not text is invalid_input", () => {
    expect(read(id, "abc")).toEqual(ok("abc"));
    expect(read(id, 5)).toEqual(code("invalid_input"));
    expect(read(id, ABSENT)).toEqual(code("invalid_input"));
  });

  it("oneOf: one of the values; anything else is invalid_input", () => {
    const kinds = ["a", "b"] as const;
    expect(read(oneOf(kinds), "b")).toEqual(ok("b"));
    expect(read(oneOf(kinds), "c")).toEqual(code("invalid_input"));
    expect(read(oneOf(kinds), null)).toEqual(code("invalid_input"));
  });

  it("orNull: null for missing, null and \"\"; else the schema's value or code", () => {
    expect(read(orNull(calendarDate), ABSENT)).toEqual(ok(null));
    expect(read(orNull(calendarDate), null)).toEqual(ok(null));
    expect(read(orNull(calendarDate), "")).toEqual(ok(null));
    expect(read(orNull(calendarDate), "2026-10-01")).toEqual(ok("2026-10-01"));
    expect(read(orNull(calendarDate), "nope")).toEqual(code("invalid_date"));
    expect(read(orNull(calendarDate), 5)).toEqual(code("invalid_date"));
    expect(read(orNull(oneOf(["x"] as const)), "y")).toEqual(code("invalid_input"));
  });

  it("refused: absent is fine, any value is invalid_input", () => {
    expect(read(refused, ABSENT)).toEqual(ok(undefined));
    expect(read(refused, null)).toEqual(code("invalid_input"));
    expect(read(refused, "2026-10-01")).toEqual(code("invalid_input"));
  });
});

describe("changesOf", () => {
  it("keeps only the fields sent: null is a change, undefined is not", () => {
    const schema = z.object({ name: requiredText(10).optional(), notes: optionalText(10).optional(), day: calendarDate.optional() });
    expect(changesOf(parse(schema, {}))).toEqual({});
    expect(changesOf(parse(schema, { notes: null, day: undefined }))).toEqual({ notes: null });
    expect(changesOf(parse(schema, { name: " x " }))).toEqual({ name: "x" });
  });
});

describe("required, textOrBlank", () => {
  it("required: a missing value is missing_fields (or the code given); anything else is the schema's", () => {
    expect(read(required(integer(0, 10)), 3)).toEqual(ok(3));
    expect(read(required(integer(0, 10)), ABSENT)).toEqual(code("missing_fields"));
    expect(read(required(integer(0, 10)), undefined)).toEqual(code("missing_fields"));
    expect(read(required(integer(0, 10), "no_documents"), ABSENT)).toEqual(code("no_documents"));
    expect(read(required(integer(0, 10)), null)).toEqual(code("invalid_input"));
    expect(read(required(integer(0, 10)), 11)).toEqual(code("invalid_input"));
  });

  it("textOrBlank: trimmed, \"\" when missing, null or blank; not text or too long is invalid_input", () => {
    expect(read(textOrBlank(5), " hola ")).toEqual(ok("hola"));
    expect(read(textOrBlank(5), ABSENT)).toEqual(ok(""));
    expect(read(textOrBlank(5), null)).toEqual(ok(""));
    expect(read(textOrBlank(5), "   ")).toEqual(ok(""));
    expect(read(textOrBlank(5), 5)).toEqual(code("invalid_input"));
    expect(read(textOrBlank(5), "abcdef")).toEqual(code("invalid_input"));
  });
});

describe("present", () => {
  it("missing or \"\" is missing_fields; anything else as the schema reads it", () => {
    const kind = present(oneOf(["issue", "change"] as const));
    expect(read(kind, "issue")).toEqual(ok("issue"));
    expect(read(kind, ABSENT)).toEqual(code("missing_fields"));
    expect(read(kind, "")).toEqual(code("missing_fields"));
    expect(read(kind, null)).toEqual(code("invalid_input"));
    expect(read(kind, "bug")).toEqual(code("invalid_input"));
    expect(read(present(workDate), null)).toEqual(code("invalid_date"));
    // As an edit's field: absent is not sent.
    expect(read(kind.optional(), ABSENT)).toEqual(ok(undefined));
  });
});

describe("account and contact blocks", () => {
  it("sentText: a text as sent, never trimmed; undefined when not text; never fails", () => {
    expect(read(sentText, "  Pass Word1 ")).toEqual(ok("  Pass Word1 "));
    expect(read(sentText, "")).toEqual(ok(""));
    for (const other of [ABSENT, null, 7, ["a"], { a: 1 }]) expect(read(sentText, other)).toEqual(ok(undefined));
  });

  it("strongPassword: the one policy, not trimmed; anything else is weak_password", () => {
    expect(read(strongPassword, " Long-enough1 ")).toEqual(ok(" Long-enough1 "));
    for (const bad of ["Short1A", "no-uppercase-1", "No-number-here", 12345678901, null, ABSENT]) {
      expect(read(strongPassword, bad)).toEqual(code("weak_password"));
    }
  });

  it("clippedOrNull: trimmed and cut, null when blank or not text", () => {
    expect(read(clippedOrNull(3), " abcdef ")).toEqual(ok("abc"));
    for (const empty of ["  ", ABSENT, null, 5]) expect(read(clippedOrNull(3), empty)).toEqual(ok(null));
  });

  it("optionalPhone: PHONE_PATTERN, null when blank; else invalid_phone", () => {
    expect(read(optionalPhone, " +34 600 11 22 33 ")).toEqual(ok("+34 600 11 22 33"));
    expect(read(optionalPhone, "")).toEqual(ok(null));
    expect(read(optionalPhone, 600112233)).toEqual(ok(null));
    expect(read(optionalPhone, "llámame")).toEqual(code("invalid_phone"));
    expect(read(optionalPhone, "12")).toEqual(code("invalid_phone"));
  });
});
