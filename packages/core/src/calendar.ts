// Calendar dates (YYYY-MM-DD): how dates without a time travel through the API.

/** Whether `raw` is a real calendar date written YYYY-MM-DD (rejects 2026-02-31). */
export function isCalendarDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const parsed = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw;
}

/** A timestamp column holding a calendar date (UTC midnight) → YYYY-MM-DD. */
export function toCalendarDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}
