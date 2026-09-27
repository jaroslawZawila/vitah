"use client";

import { useFormatter, useLocale } from "next-intl";

/** Money, shares and calendar dates as the obra screens show them. */
export function useObraFormat() {
  const format = useFormatter();
  const locale = useLocale();
  const money = (cents: number) => format.number(cents / 100, { style: "currency", currency: "EUR" });
  const share = (bp: number) =>
    format.number(bp / 10_000, { style: "percent", maximumFractionDigits: 2 });
  const quantity = (value: number) => format.number(value, { maximumFractionDigits: 3 });
  return {
    /** Euro cents → "12.500,00 €". */
    money,
    /** "+2.570,00 €" / "−1.200,00 €". */
    signedMoney: (cents: number) => `${cents > 0 ? "+" : ""}${money(cents)}`,
    /** Basis points → "19,26 %". */
    share,
    /** `part` of `whole` → "24 %". */
    ratio: (part: number, whole: number) => share(whole ? (part * 10_000) / whole : 0),
    /** YYYY-MM-DD → "24 sept 2026". */
    date: (day: string) =>
      format.dateTime(new Date(`${day}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }),
    /** A quantity with up to 3 decimals. */
    quantity,
    /** Basis points as a % to type in: 1300 → "13", 1250 → "12,5". */
    pctInput: (bp: number) => quantity(bp / 100),
    /** A number typed in this language ("1.234,5" in Spanish); null if it isn't one. */
    parse: (text: string) => parseDecimal(text, locale),
    /** A typed amount in hundredths (see `parseHundredths`). */
    hundredths: (text: string) => parseHundredths(text, locale),
    /** A number with 2 decimals, e.g. "253,45" (amounts in forms). */
    decimal: (value: number) =>
      format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  };
}

/**
 * Reads a number as typed in `locale`: Spanish "1.234,5" or English "1,234.5".
 * With a single kind of separator, the language's decimal mark is the
 * decimal point; the other one is a thousands separator only when it splits
 * off groups of exactly three digits ("12.345"), else a decimal point too
 * ("3.50" typed in Spanish is 3,5). Null when it isn't a number.
 */
export function parseDecimal(text: string, locale: string): number | null {
  const raw = text.trim().replace(/\s|€|%/g, "");
  if (!raw) return null;
  const mark = locale.startsWith("es") ? "," : ".";
  const other = mark === "," ? "." : ",";
  let decimal: string | null;
  if (raw.includes(mark) && raw.includes(other)) {
    decimal = raw.lastIndexOf(mark) > raw.lastIndexOf(other) ? mark : other;
  } else if (raw.includes(other)) {
    const grouped = new RegExp(`^\\d{1,3}(\\${other}\\d{3})+$`).test(raw);
    decimal = grouped ? null : other;
  } else {
    decimal = raw.includes(mark) ? mark : null;
  }
  const thousands = decimal === "," ? "." : decimal === "." ? "," : other;
  const normal = raw.split(thousands).join("").replace(decimal ?? "\u0000", ".");
  if (!/^\d+(\.\d+)?$/.test(normal)) return null;
  return Number(normal);
}

/**
 * A typed amount in hundredths: euros → cents, % → basis points. NaN when it
 * isn't a number, which core rejects as `invalid_input`.
 */
export function parseHundredths(text: string, locale: string): number {
  const value = parseDecimal(text, locale);
  return value === null ? Number.NaN : Math.round(value * 100);
}
