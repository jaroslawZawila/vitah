/** Formats a calendar date (YYYY-MM-DD) as "1 de marzo de 2026". */
export function formatDate(calendarDate: string): string {
  const [year, month, day] = calendarDate.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Formats an ISO timestamp as a short Spanish date: "22 sept". */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Madrid",
  });
}

/** Formats a byte count as "180 KB" or "3,1 MB". */
export function formatFileSize(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB`;
}
