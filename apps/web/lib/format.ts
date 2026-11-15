import { useLocale } from "next-intl";
import {
  formatAmount,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDecimal,
  formatFileSize,
  formatMonth,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
  formatSignedAmount,
  formatSignedMoney,
  formatSignedPercent,
  type NumberOptions,
} from "@repo/core/format";

/**
 * The portal's one way of writing figures and dates, in the page's language
 * (rules in packages/core/src/format.ts): every money, number, percentage,
 * quantity and date on screen goes through it. Lint forbids `toLocaleString`,
 * `Intl.NumberFormat`/`DateTimeFormat` and next-intl's `useFormatter` elsewhere.
 */
export function useFormat() {
  const locale = useLocale();
  return {
    locale,
    /** 12500 → "12.500"; `maxDecimals` etc. for decimals. */
    number: (value: number, options?: NumberOptions) => formatNumber(value, locale, options),
    /** Exactly `decimals` decimals (2 by default): "253,40". */
    decimal: (value: number, decimals?: number) => formatDecimal(value, locale, decimals),
    /** Up to 3 decimals: "12.345,5". */
    quantity: (value: number) => formatQuantity(value, locale),
    /** Euro cents → "8.543,98 €". */
    money: (cents: number) => formatMoney(cents, locale),
    /** "+2.570,00 €" / "−1.200,00 €". */
    signedMoney: (cents: number) => formatSignedMoney(cents, locale),
    /** Euro cents without the symbol (tables headed "€"): "8.543,98". */
    amount: (cents: number) => formatAmount(cents, locale),
    /** The same, signed: "+196,00" / "−196,00". */
    signedAmount: (cents: number) => formatSignedAmount(cents, locale),
    /** Basis points → "19,26 %" (up to 2 decimals, or as told). */
    percent: (bp: number, options?: NumberOptions) => formatPercent(bp, locale, options),
    /** Basis points, signed, `decimals` decimals: "+1,4 %". */
    signedPercent: (bp: number, decimals?: number) => formatSignedPercent(bp, locale, decimals),
    /** "340 kB", "3,1 MB". */
    fileSize: (bytes: number) => formatFileSize(bytes, locale),
    /** A day (YYYY-MM-DD) or a timestamp's day in Spain: "10 mar 2026"; none (null, undefined, "") → "—". */
    date: (value: string | Date | null | undefined) => formatDate(value, locale),
    /** A moment in Spain's time: "10 mar 2026, 14:05". */
    dateTime: (value: string | Date) => formatDateTime(value, locale),
    /** "13 oct 2026 – 17 oct 2026". */
    dateRange: (from: string | Date, to: string | Date) => formatDateRange(from, to, locale),
    /** "oct": a chart or timeline axis only, its year shown nearby. */
    month: (value: string | Date) => formatMonth(value, locale),
  };
}

export type Format = ReturnType<typeof useFormat>;
