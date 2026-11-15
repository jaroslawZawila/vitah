"use client";

import { useFormat } from "@/lib/format";
import { useObraFormat } from "../obra/format";

// Day arithmetic is core's, the same the server uses.
export { daysBetween, spanDays } from "@repo/core/control-calc";
export { addDays } from "@repo/core/obra-calc";

/** "−" (a true minus) or "+" before a non-zero figure. */
const sign = (value: number) => (value > 0 ? "+" : value < 0 ? "−" : "");

/**
 * Figures as the Obra tab shows them: amounts with their cents, signed
 * deviations (positive = overrun) and signed day counts. Dates and money are
 * the portal's one style (`useFormat`).
 */
export function useControlFormat() {
  const f = useFormat();
  const obra = useObraFormat();

  return {
    ...obra,
    /** "jun": the Gantt's month axis only. */
    month: f.month,
    /** Cents with their two decimals, no symbol: "3.120,00" (tables that say they are in euros). */
    amount: f.amount,
    /** The same, signed: "+196,00" / "−196,00". */
    signedAmount: f.signedAmount,
    /** "13 oct 2026 – 17 oct 2026" */
    dateRange: f.dateRange,
    /** Basis points as a signed %: "+1,4 %" (1 decimal unless told otherwise). */
    signedPercent: f.signedPercent,
    /** "+8 d" / "−2 d" / "0 d" */
    signedDays: (days: number) => `${sign(days)}${Math.abs(days)} d`,
  };
}

export type ControlFormat = ReturnType<typeof useControlFormat>;

/** The text colour of a deviation: a saving is good, an overrun bad. */
export const deviationTone = (cents: number | null) =>
  cents === null || cents === 0 ? "" : cents > 0 ? "text-bad" : "text-good";
