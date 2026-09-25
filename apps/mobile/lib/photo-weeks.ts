import type { MobilePhoto } from "@repo/core/contract";
import { spanishDayUtc } from "./dates";

export type PhotoWeek = {
  /** e.g. "2026-W39"; stable React key. */
  key: string;
  /** ISO week number, shown as "Semana 39". */
  week: number;
  photos: MobilePhoto[];
};

/** The ISO week (year and number) of a timestamp, as a calendar day in Spain. */
function isoWeek(iso: string) {
  const d = new Date(spanishDayUtc(new Date(iso)));
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
