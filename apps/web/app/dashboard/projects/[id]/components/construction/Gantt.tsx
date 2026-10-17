"use client";

import { useTranslations } from "next-intl";
import type { ControlChapter } from "@repo/core/contract";
import { cn } from "@/lib/utils";
import { daysBetween, spanDays, useControlFormat } from "./format";

/** The span the mini Gantt draws: the works' dates, widened to every chapter's dates and today. */
export type Timeline = { start: string; end: string; months: string[] };

/** The timeline of a set of chapters; null when no date is known at all. */
export function timelineOf(
  chapters: ControlChapter[],
  project: { startDate: string | null; completionDate: string | null },
  today: string,
): Timeline | null {
  const dates = [
    project.startDate,
    project.completionDate,
    ...chapters.flatMap((c) => [c.plannedStart, c.plannedEnd, c.actualStart, c.actualEnd]),
  ].filter((d): d is string => !!d);
  if (dates.length === 0) return null;
  dates.push(today);
  dates.sort();
  const start = dates[0]!;
  const end = dates.at(-1)!;
  // The first day of each month in the span.
  const months: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  for (;;) {
    const first = `${year}-${String(month).padStart(2, "0")}-01`;
    if (first > end) break;
    months.push(first < start ? start : first);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { start, end, months };
}

/** A day's position on the timeline, 0–100 (%). */
function at(timeline: Timeline, day: string) {
  const total = spanDays(timeline.start, timeline.end);
  return Math.min(100, Math.max(0, (daysBetween(timeline.start, day) / total) * 100));
}

/** From `from` to the end of `to`, as left/width styles. */
function bar(timeline: Timeline, from: string, to: string) {
  const left = at(timeline, from);
  const total = spanDays(timeline.start, timeline.end);
  const right = Math.min(100, (spanDays(timeline.start, to) / total) * 100);
  return { left: `${left}%`, width: `${Math.max(0.6, right - left)}%` };
}

const IN_PROGRESS =
  "bg-[repeating-linear-gradient(135deg,var(--color-primary)_0_6px,var(--color-rail-accent)_6px_12px)]";

/** Presentational: the month labels above the bars (decorative). */
export function MonthAxis({ timeline, className }: { timeline: Timeline; className?: string }) {
  const f = useControlFormat();
  return (
    <div aria-hidden className={cn("relative h-4 min-w-[340px] font-mono text-[10.5px] font-normal tracking-normal text-muted-foreground normal-case", className)}>
      {timeline.months.map((month) => (
        <span key={month} className="absolute top-0" style={{ left: `${at(timeline, month)}%` }}>
          {f.month(month)}
        </span>
      ))}
    </div>
  );
}

/**
 * Presentational: one chapter on the timeline: its plan (outlined, from
 * Planning) above what really happened (solid when finished, striped while in
 * progress, up to today), and a dashed line at today.
 */
export function GanttBar({
  chapter,
  timeline,
  today,
  className,
}: {
  chapter: ControlChapter;
  timeline: Timeline;
  today: string;
  className?: string;
}) {
  const t = useTranslations("construction.gantt");
  const f = useControlFormat();
  const plan =
    chapter.plannedStart && chapter.plannedEnd
      ? t("plan", { start: f.day(chapter.plannedStart), end: f.day(chapter.plannedEnd) })
      : null;
  const actual = chapter.actualStart
    ? chapter.actualEnd
      ? t("actual", { start: f.day(chapter.actualStart), end: f.day(chapter.actualEnd) })
      : t("actualSince", { start: f.day(chapter.actualStart) })
    : null;
  const actualEnd = chapter.actualEnd ?? (chapter.actualStart && today >= chapter.actualStart ? today : null);

  return (
    <div
      role="img"
      aria-label={[plan, actual].filter(Boolean).join(", ") || t("noDates")}
      className={cn("relative h-[30px] min-w-[340px]", className)}
    >
      {timeline.months.slice(1).map((month) => (
        <span key={month} aria-hidden className="absolute inset-y-0 border-l border-border/70" style={{ left: `${at(timeline, month)}%` }} />
      ))}
      {chapter.plannedStart && chapter.plannedEnd && (
        <span
          className="absolute top-[5px] h-2 rounded-[4px] border-[1.5px] border-muted-foreground/70"
          style={bar(timeline, chapter.plannedStart, chapter.plannedEnd)}
        />
      )}
      {chapter.actualStart && actualEnd && (
        <span
          className={cn("absolute top-[17px] h-2 rounded-[4px]", chapter.actualEnd ? "bg-good" : IN_PROGRESS)}
          style={bar(timeline, chapter.actualStart, actualEnd)}
        />
      )}
      <span
        aria-hidden
        className="absolute -inset-y-2 border-l-2 border-dashed border-bad"
        style={{ left: `${at(timeline, today)}%` }}
      />
    </div>
  );
}

/** Presentational: what the bars mean. */
export function GanttLegend({ today, planSource }: { today: string; planSource: React.ReactNode }) {
  const t = useTranslations("construction.gantt");
  const f = useControlFormat();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2 w-5 rounded-[4px] border-[1.5px] border-muted-foreground/70" />
        {t("legendPlan")} {planSource}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2 w-5 rounded-[4px] bg-good" />
        {t("legendActual")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className={cn("h-2 w-5 rounded-[4px]", IN_PROGRESS)} />
        {t("legendInProgress")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-3.5 border-l-2 border-dashed border-bad" />
        {t("legendToday", { date: f.day(today) })}
      </span>
    </div>
  );
}
