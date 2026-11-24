"use client";

import { useTranslations } from "next-intl";
import type { ControlChapter, PlanningRow } from "@repo/core/contract";
import { cn } from "@/lib/utils";
import { addDays, daysBetween, spanDays, useControlFormat } from "./format";

/** The span the mini Gantt draws: the works' dates, widened to every chapter's dates and today. */
export type Timeline = { start: string; end: string; months: string[] };

/** The timeline of a set of chapters (and `more` days, such as a forecast); null when no date is known at all. */
export function timelineOf(
  chapters: ControlChapter[],
  project: { startDate: string | null; completionDate: string | null },
  today: string,
  more: (string | null)[] = [],
): Timeline | null {
  return timelineSpanning([
    project.startDate,
    project.completionDate,
    ...chapters.flatMap((c) => [c.plannedStart, c.plannedEnd, c.actualStart, c.actualEnd]),
    ...more,
  ], today);
}

/** The timeline from the first to the last of `days` (and today), month by month; null without any. */
export function timelineSpanning(days: (string | null)[], today: string): Timeline | null {
  const dates = days.filter((d): d is string => !!d);
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
export function at(timeline: Timeline, day: string) {
  const total = spanDays(timeline.start, timeline.end);
  return Math.min(100, Math.max(0, (daysBetween(timeline.start, day) / total) * 100));
}

/** From `from` to the end of `to`, as left/width styles. */
export function bar(timeline: Timeline, from: string, to: string) {
  const left = at(timeline, from);
  const total = spanDays(timeline.start, timeline.end);
  const right = Math.min(100, (spanDays(timeline.start, to) / total) * 100);
  return { left: `${left}%`, width: `${Math.max(0.6, right - left)}%` };
}

const IN_PROGRESS =
  "bg-[repeating-linear-gradient(135deg,var(--color-primary)_0_6px,var(--color-rail-accent)_6px_12px)]";

/** What is still to happen, as the approved plan forecasts it; ringed on the critical path. */
const FORECAST = "bg-muted-foreground/25";
const CRITICAL = "ring-[1.5px] ring-warn ring-inset";

/** Presentational: the month labels above the bars (decorative). */
export function MonthAxis({ timeline, className }: { timeline: Timeline; className?: string }) {
  const f = useControlFormat();
  return (
    <div aria-hidden className={cn("relative h-4 min-w-[340px] font-mono text-xs font-normal tracking-normal text-muted-foreground normal-case", className)}>
      {timeline.months.map((month) => (
        <span key={month} className="absolute top-0" style={{ left: `${at(timeline, month)}%` }}>
          {f.month(month)}
        </span>
      ))}
    </div>
  );
}

/**
 * Presentational: one chapter on the timeline: its plan (outlined: the
 * baseline, or simulated dates; left out when `showPlan` is off) above what
 * really happened (solid when finished, striped while in progress, up to
 * today), then what is still to happen as the plan forecasts it (grey, ringed
 * on the critical path), and a dashed line at today.
 */
export function GanttBar({
  chapter,
  timeline,
  today,
  forecast,
  showPlan,
  className,
}: {
  chapter: ControlChapter;
  timeline: Timeline;
  today: string;
  /** The chapter's row of the approved plan; none without one. */
  forecast?: Pick<PlanningRow, "forecastStart" | "forecastEnd" | "critical">;
  showPlan: boolean;
  className?: string;
}) {
  const t = useTranslations("construction.gantt");
  const f = useControlFormat();
  const planned =
    showPlan && chapter.plannedStart && chapter.plannedEnd ? { from: chapter.plannedStart, to: chapter.plannedEnd } : null;
  const actual = chapter.actualStart
    ? chapter.actualEnd
      ? t("actual", { start: f.date(chapter.actualStart), end: f.date(chapter.actualEnd) })
      : t("actualSince", { start: f.date(chapter.actualStart) })
    : null;
  const actualEnd = chapter.actualEnd ?? (chapter.actualStart && today >= chapter.actualStart ? today : null);
  // What is left: a pending chapter's forecast, or an open one's after today (the striped bar ends at today) to its forecast end.
  const from = chapter.state === "pending" ? forecast?.forecastStart : addDays(today, 1);
  const ahead =
    forecast && from && chapter.state !== "finished" && forecast.forecastEnd >= from
      ? { from, to: forecast.forecastEnd, critical: forecast.critical }
      : null;
  const label = [
    planned && t("plan", { start: f.date(planned.from), end: f.date(planned.to) }),
    actual,
    ahead && t("forecast", { start: f.date(ahead.from), end: f.date(ahead.to) }),
  ];

  return (
    <div
      role="img"
      aria-label={label.filter(Boolean).join(", ") || t("noDates")}
      className={cn("relative h-[30px] min-w-[340px]", className)}
    >
      {timeline.months.slice(1).map((month) => (
        <span key={month} aria-hidden className="absolute inset-y-0 border-l border-border/70" style={{ left: `${at(timeline, month)}%` }} />
      ))}
      {planned && (
        <span
          className="absolute top-[5px] h-2 rounded-[4px] border-[1.5px] border-muted-foreground/70"
          style={bar(timeline, planned.from, planned.to)}
        />
      )}
      {ahead && (
        <span
          className={cn("absolute top-[17px] h-2 rounded-[4px]", FORECAST, ahead.critical && CRITICAL)}
          style={bar(timeline, ahead.from, ahead.to)}
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

/**
 * Presentational: what the bars mean. With an approved plan (`baseline`) the
 * outlined bar is its baseline, and what is still to happen and the critical
 * path are drawn too; without one it is the plan, from `planSource`.
 */
export function GanttLegend({
  today,
  baseline,
  planSource,
  showPlan,
}: {
  today: string;
  baseline: boolean;
  planSource: React.ReactNode;
  showPlan: boolean;
}) {
  const t = useTranslations("construction.gantt");
  const f = useControlFormat();
  const item = "inline-flex items-center gap-1.5";
  const swatch = "h-2 w-5 rounded-[4px]";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-meta text-muted-foreground">
      {showPlan && (
        <span className={item}>
          <span aria-hidden className={cn(swatch, "border-[1.5px] border-muted-foreground/70")} />
          {baseline ? (
            t("legendBaseline")
          ) : (
            <>
              {t("legendPlan")} {planSource}
            </>
          )}
        </span>
      )}
      <span className={item}>
        <span aria-hidden className={cn(swatch, "bg-good")} />
        {t("legendActual")}
      </span>
      <span className={item}>
        <span aria-hidden className={cn(swatch, IN_PROGRESS)} />
        {t("legendInProgress")}
      </span>
      {baseline && (
        <>
          <span className={item}>
            <span aria-hidden className={cn(swatch, FORECAST)} />
            {t("legendForecast")}
          </span>
          <span className={item}>
            <span aria-hidden className={cn(swatch, FORECAST, CRITICAL)} />
            {t("legendCritical")}
          </span>
        </>
      )}
      <span className={item}>
        <span aria-hidden className="h-3.5 border-l-2 border-dashed border-bad" />
        {t("legendToday", { date: f.date(today) })}
      </span>
    </div>
  );
}
