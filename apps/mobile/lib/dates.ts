// Calendar arithmetic in Spain's time zone, where the projects are.

export const SPAIN_TZ = "Europe/Madrid";

// Built once: creating formatters is slow on Hermes.
const spanishDay = new Intl.DateTimeFormat("en", {
  timeZone: SPAIN_TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

/** A calendar date (YYYY-MM-DD) as midnight UTC of that day (ms). */
export function calendarDayUtc(calendarDate: string): number {
  const [year, month, day] = calendarDate.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!);
}

/** A moment's calendar day in Spain, as midnight UTC of that day (ms). */
export function spanishDayUtc(moment: Date): number {
  // Read by part: the order and separators of a formatted date vary by ICU version.
  const parts = spanishDay.formatToParts(moment);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"));
}

/** Whole days from today (in Spain) until a calendar date (YYYY-MM-DD); negative once past. */
export function daysUntil(calendarDate: string, now: Date = new Date()): number {
  return Math.round((calendarDayUtc(calendarDate) - spanishDayUtc(now)) / 86_400_000);
}
