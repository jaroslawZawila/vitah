"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PlanningCalendar, PlanningRow, PlanningRule, ProjectPlanning } from "@repo/core/contract";
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
    return rule.fixedStart ? t("fixed", { date: f.day(rule.fixedStart) }) : t("fromStart");
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
            ? t("approvedBy", { date: f.stampDay(baseline.approvedAt), name: baseline.approvedBy })
            : t("approvedOn", { date: f.stampDay(baseline.approvedAt) }))}
        {baseline.reason && <> · {t("reason", { reason: baseline.reason })}</>}
      </span>
    </div>
  );
}

/** The figures that matter: when it started, when the contract ends, where the works are heading and what it costs. */
export function PlanKpis({ baseline, completionDate }: { baseline: Baseline; completionDate: string | null }) {
  const t = useTranslations("planning.kpis");
  const tp = useTranslations("planning");
  const f = useControlFormat();
  const { forecast } = baseline;
  const critical = baseline.rows.filter((r) => r.critical).sort((a, b) => a.forecastStart.localeCompare(b.forecastStart));
  const delay = forecast.delayDays;
  const late = delay !== null && delay > 0;
  return (
    <section aria-label={t("label")} className="grid grid-cols-[repeat(auto-fit,minmax(min(190px,100%),1fr))] gap-3">
      <Kpi label={t("start")} value={f.fullDay(baseline.startDate)} hints={[t("startHint")]} />
      <Kpi
        label={t("contract")}
        value={completionDate ? f.fullDay(completionDate) : "—"}
        hints={[completionDate ? t("contractHint") : t("noContract")]}
      />
      <Kpi
        label={t("forecast")}
        value={<span className={cn(late && "text-warn")}>{f.fullDay(forecast.endDate)}</span>}
        hints={[
          delay === null ? t("baselineEnd", { date: f.fullDay(baseline.planned.endDate) }) : late ? t("late", { count: delay }) : tp("margin", { count: -delay }),
        ]}
      />
      <Kpi
        label={t("penalty")}
        value={<span className={cn(forecast.penaltyCents > 0 && "text-bad")}>{f.moneyRound(forecast.penaltyCents)}</span>}
        hints={[late && delay <= 14 ? t("penaltyFrom", { count: 15 - delay }) : t("penaltyHint")]}
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
      aria-label={t("barLabel", { forecast: f.range(row.forecastStart, row.forecastEnd), baseline: f.range(row.plannedStart, row.plannedEnd) })}
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
        <span className={muted}>· {tp("orderBy", { date: f.day(orderByDate(row.plannedStart, row.leadDays)) })}</span>
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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-muted-foreground">
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
        {t("today", { date: f.day(today) })}
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
      <Table className="text-[13px]">
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
                <Link href={chapterHref(row.code)} className="font-semibold transition-colors hover:text-primary">
                  {row.name}
                </Link>
                <RowNotes row={row} />
              </TableCell>
              <TableCell className="num whitespace-nowrap">
                {f.day(row.forecastStart)} – {f.day(row.forecastEnd)}
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

/** On phones: a card per chapter with its state, bar and dates. */
export function PlanCards({
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
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0 md:hidden" aria-label={t("label")}>
      {rows.map((row) => {
        const slip = slipDays(row);
        return (
          <li key={row.code} className={cn(cardVariants(), "gap-2")}>
            <div className="flex items-start gap-2.5">
              <span className="num pt-px font-semibold">{row.code}</span>
              <Link href={chapterHref(row.code)} className="min-w-0 flex-1 leading-snug font-semibold">
                {row.name}
              </Link>
              <ChapterStatePill state={row.state} />
            </div>
            <PlanBar row={row} timeline={timeline} today={today} showBaseline={showBaseline} className="min-w-0" />
            <div className="flex flex-wrap justify-between gap-2 text-[12.5px]">
              <span className="num">
                {f.day(row.forecastStart)} – {f.day(row.forecastEnd)}
              </span>
              {slip > 0 ? (
                <span className="text-warn">{t("lateLong", { days: f.signedDays(slip) })}</span>
              ) : (
                row.critical && <span className="text-warn">{t("critical")}</span>
              )}
            </div>
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
        <span className={muted}>{t("text", { name: draft.createdBy ?? "—", date: f.stampDay(draft.createdAt) })}</span>
      </span>
      <Link href={href} className="text-[13.5px] font-semibold text-brand-ink hover:underline">
        {canManage ? t("edit") : t("view")}
      </Link>
    </div>
  );
}
