import type { AppLanguage } from "@repo/core/contract";
import { SPAIN_TZ, calendarDayUtc } from "./dates";

const LOCALES: Record<AppLanguage, string> = { es: "es-ES", en: "en-GB" };

/** Formats a calendar date (YYYY-MM-DD) as "10 mar 2026" / "10 Mar 2026". */
export function formatMediumDate(calendarDate: string, language: AppLanguage = "es"): string {
  return formatCalendarDate(calendarDate, language, { day: "numeric", month: "short", year: "numeric" });
}

/** A calendar date (YYYY-MM-DD) in the app's language, without the dots of short months. */
function formatCalendarDate(
  calendarDate: string,
  language: AppLanguage,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Date(calendarDayUtc(calendarDate))
    .toLocaleDateString(LOCALES[language], { ...options, timeZone: "UTC" })
    .replace(/\./g, "");
}

/** Formats an ISO timestamp as a short date in Spain's time zone: "22 sept" / "22 Sept". */
export function formatShortDate(iso: string, language: AppLanguage = "es"): string {
  return new Date(iso).toLocaleDateString(LOCALES[language], {
    day: "numeric",
    month: "short",
    timeZone: SPAIN_TZ,
  });
}

/** Formats a byte count as "180 KB" or "3,1 MB" / "3.1 MB". */
export function formatFileSize(bytes: number, language: AppLanguage = "es"): string {
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toLocaleString(LOCALES[language], { maximumFractionDigits: 1 })} MB`;
}

/**
 * Formats euro cents as "73.953,84 €" / "€73,953.84", like the portal (Spanish
 * groups thousands from 10.000 on, as Intl does). By hand: Intl's currency
 * style is not verified on the app's JS engine (Hermes), which lacks parts of
 * Intl (PluralRules), and a wrong amount must never reach a client.
 */
export function formatMoney(cents: number, language: AppLanguage = "es"): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = String(Math.floor(abs / 100));
  const fraction = String(abs % 100).padStart(2, "0");
  const [group, mark] = language === "es" ? [".", ","] : [",", "."];
  const grouped =
    language === "es" && whole.length <= 4 ? whole : whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const amount = `${grouped}${mark}${fraction}`;
  const text = language === "es" ? `${amount} €` : `€${amount}`;
  return negative ? `−${text}` : text;
}

/** A calendar date's month, short: "abr" / "Apr". */
export function formatShortMonth(calendarDate: string, language: AppLanguage = "es"): string {
  return formatCalendarDate(calendarDate, language, { month: "short" });
}

/** A calendar date as day and short month: "1 oct" / "1 Oct". */
export function formatDayMonth(calendarDate: string, language: AppLanguage = "es"): string {
  return formatCalendarDate(calendarDate, language, { day: "numeric", month: "short" });
}

/** A calendar date as short month and year: "feb 2027" / "Feb 2027". */
export function formatMonthYear(calendarDate: string, language: AppLanguage = "es"): string {
  return formatCalendarDate(calendarDate, language, { month: "short", year: "numeric" });
}

/** Basis points as a percent: 1300 → "13 %", 1926 → "19,26 %". */
export function formatShare(bp: number, language: AppLanguage = "es"): string {
  const pct = (bp / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${language === "es" ? pct.replace(".", ",") : pct} %`;
}
