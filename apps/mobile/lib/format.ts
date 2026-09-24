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
