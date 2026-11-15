import type { AppLanguage } from "@repo/core/contract";
import { formatMoney } from "./format";

/** A difference with its sign: "+500,00 €", "−1.200,00 €", "0,00 €". */
export function signedMoney(cents: number, language: AppLanguage = "es"): string {
  return cents > 0 ? `+${formatMoney(cents, language)}` : formatMoney(cents, language);
}

/** A change's number as the builder's log writes it: 4 → "004" (shown as "CAM-004"). */
export const changeNumber = (number: number) => String(number).padStart(3, "0");
