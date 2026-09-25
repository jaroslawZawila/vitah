import type { AppLanguage } from "@repo/core/contract";
import { SPAIN_TZ, calendarDayUtc } from "./dates";

const LOCALES: Record<AppLanguage, string> = { es: "es-ES", en: "en-GB" };

/** Formats a calendar date (YYYY-MM-DD) as "10 mar 2026" / "10 Mar 2026". */
export function formatMediumDate(calendarDate: string, language: AppLanguage = "es"): string {
  return new Date(calendarDayUtc(calendarDate))
    .toLocaleDateString(LOCALES[language], {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
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
