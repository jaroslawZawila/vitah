"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PlanningCalendar, PlanningRow, PlanningRule, ProjectPlanning, ScheduleStatus } from "@repo/core/contract";
import { orderByDate } from "@repo/core/planning-calc";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import Kpi from "../obra/Kpi";
import { muted } from "../obra/classes";
import { daysBetween, useControlFormat } from "../construction/format";
import { at, bar, MonthAxis, type Timeline } from "../construction/Gantt";
import { ChapterStatePill } from "../construction/pills";
import { stretchedLink, touchLink } from "../../../../components/touch";

// Presentational: Obra › Planificación, the approved baseline: its key
// figures, and each chapter's rule and dates on a timeline (a table from
// 768px, cards on phones).

type Baseline = NonNullable<ProjectPlanning["baseline"]>;

/** "Tras 03 · +5 d", "Desde el inicio", "Desde el 09/11", "Toda la obra". */
export function useRuleText() {
  const t = useTranslations("planning.rule");
  const f = useControlFormat();
  return (rule: PlanningRule) => {
    if (rule.spansWorks) return t("spans");
    if (rule.after) return rule.lagDays === 0 ? t("after", { code: rule.after }) : t("afterLag", { code: rule.after, lag: f.signedDays(rule.lagDays) });
    return rule.fixedStart ? t("fixed", { date: f.date(rule.fixedStart) }) : t("fromStart");
  };
}

/** "festivos nacionales y de Asturias, cierre de agosto y Navidad". */
export function useCalendarText() {
  const t = useTranslations("planning.calendar");
  return (calendar: PlanningCalendar) => {
    const parts = [t(`holidays.${calendar.region ?? "none"}`)];
    if (calendar.augustClosure) parts.push(t("august"));
    if (calendar.christmasClosure) parts.push(t("christmas"));
    return parts.join(", ");
  };
}

/** Days the forecast ends after the baseline (calendar days); 0 when on time or spanning the works. */
export const slipDays = (row: PlanningRow) => (row.spansWorks ? 0 : Math.max(0, daysBetween(row.plannedEnd, row.forecastEnd)));

/** The baseline's version, who approved it and why. */
export function BaselineBanner({ baseline }: { baseline: Baseline }) {
  const t = useTranslations("planning");
  const f = useControlFormat();
  return (
    <div className={cn(cardVariants(), "flex-row flex-wrap items-center gap-x-3.5 gap-y-2 py-3")}>
      <Badge variant="good">{t("baselineBadge", { number: baseline.number })}</Badge>
      <span className={muted}>
        {baseline.approvedAt &&
          (baseline.approvedBy
            ? t("approvedBy", { date: f.date(baseline.approvedAt), name: baseline.approvedBy })
            : t("approvedOn", { date: f.date(baseline.approvedAt) }))}
        {baseline.reason && <> · {t("reason", { reason: baseline.reason })}</>}
      </span>
    </div>
  );
}

/** The figures that matter: when it started, when the contract ends and where the works are heading. */
export function PlanKpis({ baseline, completionDate }: { baseline: Baseline; completionDate: string | null }) {
  const t = useTranslations("planning.kpis");
  const tp = useTranslations("planning");
  const f = useControlFormat();
  const { forecast } = baseline;
  const critical = baseline.rows.filter((r) => r.critical).sort((a, b) => a.forecastStart.localeCompare(b.forecastStart));
  const delay = forecast.delayDays;
  const late = delay !== null && delay > 0;
  return (
    // Two figures a row on a phone (from 360px), so the chapters come sooner.
    <section
      aria-label={t("label")}
      className="grid gap-3 min-[360px]:grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(min(190px,100%),1fr))]"
    >
      <Kpi label={t("start")} value={f.date(baseline.startDate)} hints={[t("startHint")]} />
      <Kpi
        label={t("contract")}
        value={f.date(completionDate)}
        hints={[completionDate ? t("contractHint") : t("noContract")]}
      />
      <Kpi
        label={t("forecast")}
        value={<span className={cn(late && "text-warn")}>{f.date(forecast.endDate)}</span>}
        hints={[
          delay === null ? t("baselineEnd", { date: f.date(baseline.planned.endDate) }) : late ? t("late", { count: delay }) : tp("margin", { count: -delay }),
        ]}
      />
      <Kpi
        label={t("critical")}
        value={critical.length > 0 ? t("criticalCount", { count: critical.length }) : t("criticalNone")}
        hints={critical.length > 0 ? [critical.map((r) => r.code).join(" → ")] : []}
      />
    </section>
  );
}

const BAR_TONE: Record<PlanningRow["state"], string> = {
  finished: "bg-good",
  in_progress: "bg-brand-soft",
  pending: "bg-muted-foreground/25",
};

/** A chapter on the timeline: where it is heading, with the baseline under it and a line at today. */
export function PlanBar({
  row,
  timeline,
  today,
  showBaseline,
  className,
}: {
  row: PlanningRow;
  timeline: Timeline;
  today: string;
  showBaseline: boolean;
  className?: string;
}) {
  const t = useTranslations("planning.table");
  const f = useControlFormat();
  return (
    <div
      role="img"
      aria-label={t("barLabel", { forecast: f.dateRange(row.forecastStart, row.forecastEnd), baseline: f.dateRange(row.plannedStart, row.plannedEnd) })}
      className={cn("relative h-[30px] min-w-[300px]", className)}
    >
      {timeline.months.slice(1).map((month) => (
        <span key={month} aria-hidden className="absolute inset-y-0 border-l border-border/70" style={{ left: `${at(timeline, month)}%` }} />
      ))}
      {showBaseline && (
        <span aria-hidden className="absolute top-[21px] h-1 rounded-full bg-muted-foreground/60" style={bar(timeline, row.plannedStart, row.plannedEnd)} />
      )}
      <span
        aria-hidden
        className={cn(
          "absolute top-[5px] h-3 overflow-hidden rounded-[4px]",
          BAR_TONE[row.state],
          row.state === "pending" && row.critical && "ring-[1.5px] ring-warn ring-inset",
          row.spansWorks && "opacity-60",
        )}
        style={bar(timeline, row.forecastStart, row.forecastEnd)}
      >
        {row.state === "in_progress" && <span className="block h-full bg-primary" style={{ width: `${row.progressPct}%` }} />}
      </span>
      <span aria-hidden className="absolute -inset-y-2 border-l-2 border-dashed border-bad" style={{ left: `${at(timeline, today)}%` }} />
    </div>
  );
}

/** What a chapter waits for, its hito, when to order it, and whether it is critical or late. */
function RowNotes({ row }: { row: PlanningRow }) {
  const t = useTranslations("planning.table");
  const tp = useTranslations("planning");
  const ruleText = useRuleText();
  const f = useControlFormat();
  const slip = slipDays(row);
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
      <span className={muted}>
        {ruleText(row)}
        {row.hitoCode && <> · {row.hitoCode}</>}
      </span>
      {row.state === "pending" && row.leadDays > 0 && (
        // From the baseline's start, as Compras does: the date orders were planned to go out by.
        <span className={muted}>· {tp("orderBy", { date: f.date(orderByDate(row.plannedStart, row.leadDays)) })}</span>
      )}
      {row.critical && <Badge variant="warn">{t("critical")}</Badge>}
      {slip > 0 && <Badge variant="yel">{t("late", { days: f.signedDays(slip) })}</Badge>}
    </div>
  );
}

/** What the bars mean. */
export function PlanLegend({ today, showBaseline }: { today: string; showBaseline: boolean }) {
  const t = useTranslations("planning.legend");
  const f = useControlFormat();
  const item = "inline-flex items-center gap-1.5";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-meta text-muted-foreground">
      <span className={item}>
        <span aria-hidden className="h-2.5 w-5 rounded-[3px] bg-good" />
        {t("finished")}
      </span>
      <span className={item}>
        <span aria-hidden className="h-2.5 w-5 overflow-hidden rounded-[3px] bg-brand-soft">
          <span className="block h-full w-1/2 bg-primary" />
        </span>
        {t("inProgress")}
      </span>
      <span className={item}>
        <span aria-hidden className="h-2.5 w-5 rounded-[3px] bg-muted-foreground/25" />
        {t("pending")}
      </span>
      <span className={item}>
        <span aria-hidden className="h-2.5 w-5 rounded-[3px] bg-muted-foreground/25 ring-[1.5px] ring-warn ring-inset" />
        {t("critical")}
      </span>
      {showBaseline && (
        <span className={item}>
          <span aria-hidden className="h-1 w-5 rounded-full bg-muted-foreground/60" />
          {t("baseline")}
        </span>
      )}
      <span className={item}>
        <span aria-hidden className="h-3.5 border-l-2 border-dashed border-bad" />
        {t("today", { date: f.date(today) })}
      </span>
    </div>
  );
}

/** From 768px: every chapter with its rule, forecast dates, working days and bar. */
export function PlanTable({
  rows,
  timeline,
  today,
  showBaseline,
  chapterHref,
}: {
  rows: PlanningRow[];
  timeline: Timeline;
  today: string;
  showBaseline: boolean;
  chapterHref: (code: string) => string;
}) {
  const t = useTranslations("planning.table");
  const f = useControlFormat();
  return (
    <section className={cn(cardVariants({ size: "flush" }), "hidden py-1.5 md:flex")} aria-label={t("label")}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-[18px]">{t("code")}</TableHead>
            <TableHead>{t("chapter")}</TableHead>
            <TableHead>{t("dates")}</TableHead>
            <TableHead className="text-right">{t("days")}</TableHead>
            <TableHead className="w-[42%] pr-[18px]">
              <MonthAxis timeline={timeline} />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.code} className={cn(row.spansWorks && "bg-raise/40")}>
              <TableCell className="num pl-[18px]">{row.code}</TableCell>
              <TableCell className="min-w-[220px] whitespace-normal">
                <Link href={chapterHref(row.code)} className={cn("font-semibold transition-colors hover:text-primary", touchLink)}>
                  {row.name}
                </Link>
                <RowNotes row={row} />
              </TableCell>
              <TableCell className="num whitespace-nowrap">
                {f.date(row.forecastStart)} – {f.date(row.forecastEnd)}
              </TableCell>
              <TableCell className="num text-right">{row.spansWorks ? "—" : row.durationDays}</TableCell>
              <TableCell className="pr-[18px]">
                <PlanBar row={row} timeline={timeline} today={today} showBaseline={showBaseline} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

/**
 * Below 768px: a card per chapter in schedule order, the whole card its link:
 * its state, how it stands against the plan (the late chapters of the obra's
 * schedule status, as core lists them), the planned and real dates, its
 * working days, what it waits for, when to order it, and the critical path.
 */
export function PlanCards({
  rows,
  schedule,
  chapterHref,
}: {
  rows: PlanningRow[];
  /** The obra's schedule status: which chapters are late to start or to finish. */
  schedule: ScheduleStatus;
  chapterHref: (code: string) => string;
}) {
  const t = useTranslations("planning.table");
  const ts = useTranslations("construction.schedule");
  const ruleText = useRuleText();
  const f = useControlFormat();
  const lateToStart = new Map(schedule.lateToStart.map((c) => [c.code, c.days]));
  const lateToFinish = new Map(schedule.lateToFinish.map((c) => [c.code, c.days]));
  // In the order the works go; the chapters spanning them all last.
  const ordered = [...rows].sort(
    (a, b) => Number(a.spansWorks) - Number(b.spansWorks) || a.forecastStart.localeCompare(b.forecastStart) || a.code.localeCompare(b.code),
  );
  const term = "text-muted-foreground";
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0 md:hidden" aria-label={t("label")}>
      {ordered.map((row) => {
        const slip = slipDays(row);
        const startLate = lateToStart.get(row.code);
        const finishLate = lateToFinish.get(row.code);
        const moved = row.state !== "finished" && (row.forecastStart !== row.plannedStart || row.forecastEnd !== row.plannedEnd);
        return (
          <li key={row.code} className={cn(cardVariants(), "relative gap-2.5", row.spansWorks && "bg-raise/40")}>
            <div className="flex items-start gap-2.5">
              <span className="num pt-px font-semibold">{row.code}</span>
              <Link
                href={chapterHref(row.code)}
                className={cn("min-w-0 flex-1 leading-snug font-semibold", stretchedLink)}
              >
                {row.name}
              </Link>
              <ChapterStatePill state={row.state} />
            </div>
            {(finishLate !== undefined || startLate !== undefined || slip > 0 || row.critical) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {finishLate !== undefined && <Badge variant="warn">{ts("overdueLong", { days: f.signedDays(finishLate) })}</Badge>}
                {startLate !== undefined && <Badge variant="warn">{ts("notStarted", { days: f.signedDays(startLate) })}</Badge>}
                {slip > 0 && <Badge variant="yel">{t("late", { days: f.signedDays(slip) })}</Badge>}
                {row.critical && <Badge variant="warn">{t("critical")}</Badge>}
              </div>
            )}
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              <dt className={term}>{t("planned")}</dt>
              <dd className="m-0 tabular-nums">
                {f.date(row.plannedStart)} – {f.date(row.plannedEnd)}
              </dd>
              {moved && (
                <>
                  <dt className={term}>{t("dates")}</dt>
                  <dd className={cn("m-0 tabular-nums", slip > 0 && "text-warn")}>
                    {f.date(row.forecastStart)} – {f.date(row.forecastEnd)}
                  </dd>
                </>
              )}
              {row.actualStart && (
                <>
                  <dt className={term}>{t("actual")}</dt>
                  <dd className="m-0 tabular-nums">
                    {row.actualEnd
                      ? `${f.date(row.actualStart)} – ${f.date(row.actualEnd)}`
                      : t("actualSince", { date: f.date(row.actualStart), pct: row.progressPct })}
                  </dd>
                </>
              )}
              {!row.spansWorks && (
                <>
                  <dt className={term}>{t("duration")}</dt>
                  <dd className="m-0 tabular-nums">{t("workingDays", { count: row.durationDays })}</dd>
                </>
              )}
              <dt className={term}>{t("waitsFor")}</dt>
              <dd className="m-0">
                {ruleText(row)}
                {row.hitoCode && <> · {row.hitoCode}</>}
              </dd>
              {row.state === "pending" && row.leadDays > 0 && (
                <>
                  <dt className={term}>{t("order")}</dt>
                  <dd className="m-0 tabular-nums">{f.date(orderByDate(row.plannedStart, row.leadDays))}</dd>
                </>
              )}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

/** An open draft: who made it, and the way into it. */
export function DraftNotice({
  draft,
  href,
  canManage,
}: {
  draft: NonNullable<ProjectPlanning["draft"]>;
  href: string;
  canManage: boolean;
}) {
  const t = useTranslations("planning.draftNotice");
  const f = useControlFormat();
  return (
    <div className={cn(cardVariants(), "flex-row flex-wrap items-center justify-between gap-3 border-yel/40 bg-yel-soft/40 py-3")}>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Badge variant="yel">{t("badge", { number: draft.number })}</Badge>
        <span className={muted}>{t("text", { name: draft.createdBy ?? "—", date: f.date(draft.createdAt) })}</span>
      </span>
      <Link
        href={href}
        className={cn("text-sm font-semibold text-brand-ink hover:underline", touchLink)}
      >
        {canManage ? t("edit") : t("view")}
      </Link>
    </div>
  );
}
