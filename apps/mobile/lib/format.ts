import type { AppLanguage } from "@repo/core/contract";

const LOCALES: Record<AppLanguage, string> = { es: "es-ES", en: "en-GB" };

/** Formats a calendar date (YYYY-MM-DD) as "1 de marzo de 2026" / "1 March 2026". */
export function formatDate(calendarDate: string, language: AppLanguage = "es"): string {
  const [year, month, day] = calendarDate.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString(LOCALES[language], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Formats an ISO timestamp as a short date in Spain's time zone: "22 sept" / "22 Sept". */
export function formatShortDate(iso: string, language: AppLanguage = "es"): string {
  return new Date(iso).toLocaleDateString(LOCALES[language], {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Madrid",
  });
}

/** Formats a byte count as "180 KB" or "3,1 MB" / "3.1 MB". */
export function formatFileSize(bytes: number, language: AppLanguage = "es"): string {
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toLocaleString(LOCALES[language], { maximumFractionDigits: 1 })} MB`;
}
