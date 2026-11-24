"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Camera, MessageSquareWarning } from "lucide-react";
import type { ControlChapter, PlanningRow } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DateRange } from "../../../../components/DateRange";
import { stretchedLink } from "../../../../components/touch";
import { slipDays, useRuleText } from "../planning/PlanViews";
import { chapterLink } from "./classes";
import { daysBetween, useControlFormat } from "./format";
import { GanttBar, MonthAxis, type Timeline } from "./Gantt";
import { ChapterStatePill, SCHEDULE_TONE } from "./pills";
import { scheduleOf } from "./schedule";
import { DateSpan, dateSpan } from "./SummaryTable";

// Presentational: Obra › Planificación's chapters, their plan against what
// happened: a table with a mini Gantt from 768px, cards on phones. With an
// approved plan each chapter also has its row of it (`plans`): where it is
// heading, what it waits for, its working days, how much is built and whether
// it is on the critical path.

/** What staff can do on a chapter; each is omitted for viewers. */
export type ProgressActions = {
  onStart: (code: string) => void;
  onFinish: (code: string) => void;
  onCorrect: (code: string) => void;
  onIssue: (code: string) => void;
  onPhoto: (code: string) => void;
};

/** The approved plan's rows by chapter code; none without a baseline (the dates are then simulated). */
export type ChapterPlans = ReadonlyMap<string, PlanningRow>;

type ListProps = {
  chapters: ControlChapter[];
  timeline: Timeline | null;
  today: string;
  chapterHref: (code: string) => string;
  actions?: ProgressActions;
  plans?: ChapterPlans;
  /** "Comparar con la línea base": the plan's outlined bars. */
  showPlan: boolean;
};

/**
 * What a chapter's row of the plan adds to it: the row, how much is built
 * while it is under way, and the forecast's dates when they have left the
 * plan's (a finished chapter's real dates say it already).
 */
function usePlanOf(plans: ChapterPlans | undefined) {
  const f = useControlFormat();
  return (chapter: ControlChapter) => {
    const plan = plans?.get(chapter.code);
    const moved =
      plan && chapter.state !== "finished" && (plan.forecastStart !== plan.plannedStart || plan.forecastEnd !== plan.plannedEnd);
    return {
      plan,
      built: plan && chapter.state === "in_progress" ? f.share(plan.progressPct * 100) : null,
      forecast: plan && moved ? { dates: dateSpan(f, plan.forecastStart, plan.forecastEnd)!, late: slipDays(plan) > 0 } : null,
    };
  };
}

/** "Tras 02 · H8": what a chapter waits for in the plan, and its hito. */
function useWaitsFor() {
  const ruleText = useRuleText();
  return (plan: PlanningRow) => [ruleText(plan), plan.hitoCode].filter(Boolean).join(" · ");
}

/**
 * What to note under a chapter's name: how it stands against its plan, the
 * critical path and the forecast's slip, its open issues; and, in the table,
 * what it waits for and its working days (the phone's card lists those).
 */
function ChapterNotes({
  chapter,
  plan,
  today,
  withPlanText = false,
}: {
  chapter: ControlChapter;
  plan?: PlanningRow;
  today: string;
  withPlanText?: boolean;
}) {
  const t = useTranslations("construction.progress");
  const ts = useTranslations("construction.schedule");
  const tp = useTranslations("planning.table");
  const waitsFor = useWaitsFor();
  const f = useControlFormat();
  const schedule = scheduleOf(chapter, today);
  const slip = plan ? slipDays(plan) : 0;
  const pills: React.ReactNode[] = [];

  if (chapter.state === "in_progress" && schedule && schedule.key !== "onTime") {
    pills.push(
      <Badge key="schedule" variant={SCHEDULE_TONE[schedule.tone]}>
        {ts(schedule.key === "overdue" ? "overdueLong" : schedule.key, { days: f.signedDays(schedule.days), count: schedule.days })}
      </Badge>,
    );
  }
  if (chapter.state === "pending" && schedule?.key === "notStarted") {
    pills.push(
      <Badge key="schedule" variant="warn">
        {ts("notStarted", { days: f.signedDays(schedule.days) })}
      </Badge>,
    );
  }
  if (plan?.critical) {
    pills.push(
      <Badge key="critical" variant="warn">
        {tp("critical")}
      </Badge>,
    );
  }
  if (slip > 0) {
    pills.push(
      <Badge key="slip" variant="yel">
        {tp("late", { days: f.signedDays(slip) })}
      </Badge>,
    );
  }
  if (chapter.openIssues > 0) {
    pills.push(
      <Badge key="issues" variant="warn">
        {t("openIssues", { count: chapter.openIssues })}
      </Badge>,
    );
  }

  const notes: string[] = [];
  if (withPlanText && plan) {
    notes.push(waitsFor(plan));
    if (!plan.spansWorks) notes.push(tp("workingDays", { count: plan.durationDays }));
  }
  let note: string | null = null;
  if (chapter.state === "pending" && chapter.plannedStart && chapter.plannedStart >= today) {
    note = t("startsOn", { date: f.date(chapter.plannedStart) });
  }
  if (chapter.state === "finished" && chapter.actualDays !== null) {
    note =
      chapter.plannedDays !== null
        ? t("durationVsPlan", { actual: chapter.actualDays, planned: chapter.plannedDays })
        : t("duration", { days: chapter.actualDays });
  }

  if (pills.length === 0 && notes.length === 0 && !note) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {pills}
      {(notes.length > 0 || note) && (
        <span className="text-meta text-muted-foreground">
          {notes.join(" · ")}
          {notes.length > 0 && note && " · "}
          {note && (chapter.state === "finished" ? <span className="num">{note}</span> : note)}
        </span>
      )}
    </div>
  );
}

/** The buttons a chapter's state allows: Iniciar, Finalizar (and log an issue), or Corregir. */
function RowActions({
  chapter,
  actions,
  phone = false,
}: {
  chapter: ControlChapter;
  actions: ProgressActions;
  phone?: boolean;
}) {
  const t = useTranslations("construction.progress");
  const { code } = chapter;
  if (chapter.state === "pending") {
    return (
      <Button type="button" variant="outline" size={phone ? "default" : "sm"} onClick={() => actions.onStart(code)} aria-label={t("startLabel", { code })}>
        {t("start")}
      </Button>
    );
  }
  if (chapter.state === "finished") {
    return (
      <Button type="button" variant="ghost" size={phone ? "default" : "sm"} className="text-brand-ink" onClick={() => actions.onCorrect(code)} aria-label={t("correctLabel", { code })}>
        {phone ? t("correctDates") : t("correct")}
      </Button>
    );
  }
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button type="button" variant="ghost" size={phone ? "icon" : "icon-sm"} onClick={() => actions.onIssue(code)} aria-label={t("issueLabel", { code })} title={t("issueLabel", { code })}>
        <MessageSquareWarning aria-hidden />
      </Button>
      {phone && (
        <Button type="button" variant="ghost" size="icon" onClick={() => actions.onPhoto(code)} aria-label={t("photoLabel", { code })} title={t("photoLabel", { code })}>
          <Camera aria-hidden />
        </Button>
      )}
      <Button type="button" size={phone ? "default" : "sm"} onClick={() => actions.onFinish(code)} aria-label={t("finishLabel", { code })}>
        {t("finish")}
      </Button>
    </div>
  );
}

/** From 768px: the chapters in one list, with plan and actual dates and a mini Gantt (from xl). */
export function ProgressTable({ chapters, timeline, today, chapterHref, actions, plans, showPlan }: ListProps) {
  const t = useTranslations("construction.progress");
  const tp = useTranslations("planning.table");
  const f = useControlFormat();
  const planOf = usePlanOf(plans);

  return (
    <section className={cn(cardVariants({ size: "flush" }), "hidden py-1.5 md:flex")} aria-label={t("tableLabel")}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-[18px]">{t("chapter")}</TableHead>
            <TableHead>{t("state")}</TableHead>
            <TableHead>{t("plan")}</TableHead>
            <TableHead>{t("actual")}</TableHead>
            {/* The bars from xl: below, the table fits the card with its actions by leaving them out (the dates stay). */}
            {timeline && (
              <TableHead className="hidden w-[40%] xl:table-cell">
                <MonthAxis timeline={timeline} className="min-w-[240px]" />
              </TableHead>
            )}
            {actions && (
              <TableHead className="pr-[18px] text-right">
                <span className="sr-only">{t("actions")}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {chapters.map((chapter) => {
            const { plan, built, forecast } = planOf(chapter);
            return (
              <TableRow key={chapter.code}>
                {/* The code beside the name, not a column of its own: the table fits the card. */}
                <TableCell className="min-w-[200px] pl-[18px] whitespace-normal">
                  <span className="num mr-2 text-muted-foreground">{chapter.code}</span>
                  <Link href={chapterHref(chapter.code)} className={chapterLink}>
                    {chapter.name}
                  </Link>
                  <ChapterNotes chapter={chapter} plan={plan} today={today} withPlanText />
                </TableCell>
                <TableCell>
                  <ChapterStatePill state={chapter.state} />
                  {built !== null && <div className="num mt-1 text-meta text-muted-foreground">{t("built", { pct: built })}</div>}
                </TableCell>
                <TableCell>
                  <DateSpan f={f} start={chapter.plannedStart} end={chapter.plannedEnd} />
                  {forecast && (
                    <div className={cn("mt-1 text-meta", forecast.late ? "text-warn" : "text-muted-foreground")}>
                      {tp("forecast")} <DateRange text={forecast.dates} />
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <DateSpan f={f} start={chapter.actualStart} end={chapter.actualEnd} />
                </TableCell>
                {timeline && (
                  <TableCell className="hidden xl:table-cell">
                    <GanttBar chapter={chapter} timeline={timeline} today={today} forecast={plan} showPlan={showPlan} className="min-w-[240px]" />
                  </TableCell>
                )}
                {actions && (
                  <TableCell className="pr-[18px] text-right">
                    <RowActions chapter={chapter} actions={actions} />
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

/** On phones: a card per chapter, all of them in one list in their order. */
export function ProgressCards({ chapters, timeline, today, chapterHref, actions, plans, showPlan }: ListProps) {
  const t = useTranslations("construction.progress");
  const tp = useTranslations("planning.table");
  const waitsFor = useWaitsFor();
  const f = useControlFormat();
  const planOf = usePlanOf(plans);
  const term = "text-muted-foreground";

  return (
    <div className="flex flex-col gap-2.5 md:hidden">
      {chapters.map((chapter) => {
        const { plan, built, forecast } = planOf(chapter);
        const planned = dateSpan(f, chapter.plannedStart, chapter.plannedEnd);
        const actual = dateSpan(f, chapter.actualStart, chapter.actualEnd);
        const soon = chapter.state === "pending" && chapter.plannedStart ? daysBetween(today, chapter.plannedStart) : null;
        return (
          // The name's link covers the card; the buttons sit above it.
          <article key={chapter.code} className={cn(cardVariants(), "relative gap-2.5 p-3.5")}>
            <div className="flex items-start gap-2.5">
              <span className="num pt-0.5 font-semibold">{chapter.code}</span>
              <Link href={chapterHref(chapter.code)} className={cn("min-w-0 flex-1 leading-snug font-semibold", stretchedLink)}>
                {chapter.name}
              </Link>
              <ChapterStatePill state={chapter.state} />
            </div>
            <ChapterNotes chapter={chapter} plan={plan} today={today} />
            {/* A date span, or the "· in 1 d" after it, goes on to the next line rather than past the card. */}
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
              <dt className={term}>{t("plan")}</dt>
              <dd className="m-0">
                {planned ? <DateRange text={planned} /> : "—"}
                {soon !== null && soon >= 0 && soon <= 14 && (
                  <>
                    {" "}
                    <span className="whitespace-nowrap text-muted-foreground">· {t("inDays", { count: soon })}</span>
                  </>
                )}
              </dd>
              {forecast && (
                <>
                  <dt className={term}>{tp("forecast")}</dt>
                  <dd className={cn("m-0", forecast.late && "text-warn")}>
                    <DateRange text={forecast.dates} />
                  </dd>
                </>
              )}
              {actual && (
                <>
                  <dt className={term}>{t("actual")}</dt>
                  <dd className="m-0">
                    <DateRange text={actual} />
                    {built !== null && <span className="whitespace-nowrap text-muted-foreground"> · {t("built", { pct: built })}</span>}
                  </dd>
                </>
              )}
              {plan && !plan.spansWorks && (
                <>
                  <dt className={term}>{tp("duration")}</dt>
                  <dd className="m-0">{tp("workingDays", { count: plan.durationDays })}</dd>
                </>
              )}
              {plan && (
                <>
                  <dt className={term}>{tp("waitsFor")}</dt>
                  <dd className="m-0">{waitsFor(plan)}</dd>
                </>
              )}
            </dl>
            {/* A pending chapter's bar only with a plan: its forecast, maybe on the critical path. */}
            {timeline && (chapter.state !== "pending" || plan) && (
              <GanttBar chapter={chapter} timeline={timeline} today={today} forecast={plan} showPlan={showPlan} className="min-w-0" />
            )}
            {actions && (
              <div className="relative flex justify-end">
                <RowActions chapter={chapter} actions={actions} phone />
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
