import type { MobilePhoto } from "@repo/core/contract";

export type PhotoWeek = {
  /** e.g. "2026-W39"; stable React key. */
  key: string;
  /** ISO week number, shown as "Semana 39". */
  week: number;
  photos: MobilePhoto[];
};

// The calendar day in Spain. Built once: creating formatters is slow on Hermes.
const spanishDay = new Intl.DateTimeFormat("en", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

/** The ISO week (year and number) of a timestamp, as a calendar day in Spain. */
function isoWeek(iso: string) {
  // Read by part: the order and separators of a formatted date vary by ICU version.
  const parts = spanishDay.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const d = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  // Thursday of the same week decides the week's year.
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const weekYear = d.getUTCFullYear();
  const dayOfYear = (d.getTime() - Date.UTC(weekYear, 0, 1)) / 86_400_000;
  const week = Math.floor(dayOfYear / 7) + 1;
  return { weekYear, week };
}

/** Groups photos (newest first) into weeks, keeping their order: a week's first photo is its newest. */
export function groupByWeek(photos: MobilePhoto[]): PhotoWeek[] {
  const weeks: PhotoWeek[] = [];
  for (const photo of photos) {
    const { weekYear, week } = isoWeek(photo.uploadedAt);
    const key = `${weekYear}-W${String(week).padStart(2, "0")}`;
    const last = weeks.at(-1);
    if (last?.key === key) last.photos.push(photo);
    else weeks.push({ key, week, photos: [photo] });
  }
  return weeks;
}
