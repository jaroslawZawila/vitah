"use client";

import { useFormatter } from "next-intl";
import { useObraFormat } from "../obra/format";

/** YYYY-MM-DD → a Date at UTC midnight. */
export const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);

// Day arithmetic is core's, the same the server uses.
export { daysBetween, spanDays } from "@repo/core/control-calc";
export { addDays } from "@repo/core/obra-calc";

/** "−" (a true minus) or "+" before a non-zero figure. */
const sign = (value: number) => (value > 0 ? "+" : value < 0 ? "−" : "");

/**
 * Figures as the Obra tab shows them: dates as dd/mm, whole euros in tables,
 * signed deviations (positive = saving) and signed day counts.
 */
export function useControlFormat() {
  const format = useFormatter();
  const obra = useObraFormat();
  const euros = (cents: number) => format.number(Math.abs(cents) / 100, { maximumFractionDigits: 0 });
  const pct = (bp: number, digits: number) =>
    format.number(Math.abs(bp) / 10_000, {
      style: "percent",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });

  return {
    ...obra,
    /** 17/10 (day first in both languages, as on site) */
    day: (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`,
    /** 17/10/2026 */
    fullDay: (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`,
    /** A timestamp: 14/10 18:22, in Spain's time. */
    stamp: (iso: string) => {
      const date = new Date(iso);
      const day = date.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
      const time = format.dateTime(date, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Madrid" });
      return `${day.slice(8, 10)}/${day.slice(5, 7)} ${time}`;
    },
    /** A timestamp's day: 14/10, in Spain's time. */
    stampDay: (iso: string) => {
      const day = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
      return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
    },
    /** "jun" */
    month: (day: string) => format.dateTime(dayDate(day), { month: "short", timeZone: "UTC" }).replace(".", ""),
    /** "14 oct" */
    shortDay: (day: string) => format.dateTime(dayDate(day), { day: "numeric", month: "short", timeZone: "UTC" }),
    /** Cents with their two decimals, no symbol: "3120,00" (tables that say they are in euros). */
    amount: (cents: number) => `${cents < 0 ? "−" : ""}${obra.decimal(Math.abs(cents) / 100)}`,
    /** The same, signed: "+196,00" / "−196,00". */
    signedDecimal: (cents: number) => `${sign(cents)}${obra.decimal(Math.abs(cents) / 100)}`,
    /** "13 – 17 oct" */
    range: (from: string, to: string) =>
      from === to
        ? format.dateTime(dayDate(from), { day: "numeric", month: "short", timeZone: "UTC" })
        : format.dateTimeRange(dayDate(from), dayDate(to), { day: "numeric", month: "short", timeZone: "UTC" }),
    /** Whole euros, no symbol: "34.840" (the tables say "in euros"). */
    euros: (cents: number) => `${cents < 0 ? "−" : ""}${euros(cents)}`,
    /** "+440" / "−380" */
    signedEuros: (cents: number) => `${sign(cents)}${euros(cents)}`,
    /** Whole euros with the symbol: "495.189 €". */
    moneyRound: (cents: number) => format.number(cents / 100, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }),
    /** Basis points as a signed %: "+1,4 %" (`digits` decimals). */
    signedPct: (bp: number, digits = 1) => `${sign(bp)}${pct(bp, digits)}`,
    /** "+8 d" / "−2 d" / "0 d" */
    signedDays: (days: number) => `${sign(days)}${Math.abs(days)} d`,
  };
}

export type ControlFormat = ReturnType<typeof useControlFormat>;

/** The text colour of a deviation: a saving is good, an overrun bad. */
export const deviationTone = (cents: number | null) =>
  cents === null || cents === 0 ? "" : cents > 0 ? "text-good" : "text-bad";
