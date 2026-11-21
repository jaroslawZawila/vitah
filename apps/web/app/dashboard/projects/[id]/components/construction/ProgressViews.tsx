"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Camera, MessageSquareWarning } from "lucide-react";
import type { ControlChapter } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DateRange } from "../../../../components/DateRange";
import { chapterLink } from "./classes";
import { stretchedLink } from "../../../../components/touch";
import { daysBetween, useControlFormat } from "./format";
import { GanttBar, MonthAxis, type Timeline } from "./Gantt";
import { ChapterStatePill, SCHEDULE_TONE } from "./pills";
import { scheduleOf } from "./schedule";
import { DateSpan, dateSpan } from "./SummaryTable";

// Presentational: Obra › Avance, the chapters with their plan against what
// happened: a table with a mini Gantt from 768px, cards on phones.

/** What staff can do on a chapter; each is omitted for viewers. */
export type ProgressActions = {
  onStart: (code: string) => void;
  onFinish: (code: string) => void;
  onCorrect: (code: string) => void;
  onIssue: (code: string) => void;
  onPhoto: (code: string) => void;
};

/** What to note under a chapter's name: how it stands against its plan, its open issues, its duration. */
function ChapterNotes({ chapter, today }: { chapter: ControlChapter; today: string }) {
  const t = useTranslations("construction.progress");
  const ts = useTranslations("construction.schedule");
  const f = useControlFormat();
  const schedule = scheduleOf(chapter, today);
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
  if (chapter.openIssues > 0) {
    pills.push(
      <Badge key="issues" variant="warn">
        {t("openIssues", { count: chapter.openIssues })}
      </Badge>,
    );
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

  if (pills.length === 0 && !note) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {pills}
      {note && <span className={cn("text-meta text-muted-foreground", chapter.state === "finished" && "num")}>{note}</span>}
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

/** From 768px: the chapters in one list, with plan and actual dates and a mini Gantt. */
export function ProgressTable({
  chapters,
  timeline,
  today,
  chapterHref,
  actions,
}: {
  chapters: ControlChapter[];
  timeline: Timeline | null;
  today: string;
  chapterHref: (code: string) => string;
  actions?: ProgressActions;
}) {
  const t = useTranslations("construction.progress");
  const f = useControlFormat();

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
          {chapters.map((chapter) => (
            <TableRow key={chapter.code}>
              {/* The code beside the name, not a column of its own: the table fits the card. */}
              <TableCell className="min-w-[200px] pl-[18px] whitespace-normal">
                <span className="num mr-2 text-muted-foreground">{chapter.code}</span>
                <Link href={chapterHref(chapter.code)} className={chapterLink}>
                  {chapter.name}
                </Link>
                <ChapterNotes chapter={chapter} today={today} />
              </TableCell>
              <TableCell>
                <ChapterStatePill state={chapter.state} />
              </TableCell>
              <TableCell><DateSpan f={f} start={chapter.plannedStart} end={chapter.plannedEnd} /></TableCell>
              <TableCell><DateSpan f={f} start={chapter.actualStart} end={chapter.actualEnd} /></TableCell>
              {timeline && (
                <TableCell className="hidden xl:table-cell">
                  <GanttBar chapter={chapter} timeline={timeline} today={today} className="min-w-[240px]" />
                </TableCell>
              )}
              {actions && (
                <TableCell className="pr-[18px] text-right">
                  <RowActions chapter={chapter} actions={actions} />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

/** On phones: a card per chapter, all of them in one list in their order. */
export function ProgressCards({
  chapters,
  timeline,
  today,
  chapterHref,
  actions,
}: {
  chapters: ControlChapter[];
  timeline: Timeline | null;
  today: string;
  chapterHref: (code: string) => string;
  actions?: ProgressActions;
}) {
  const t = useTranslations("construction.progress");
  const f = useControlFormat();

  return (
    <div className="flex flex-col gap-2.5 md:hidden">
      {chapters.map((chapter) => {
        const plan = dateSpan(f, chapter.plannedStart, chapter.plannedEnd);
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
            <ChapterNotes chapter={chapter} today={today} />
            {/* A date span, or the "· in 1 d" after it, goes on to the next line rather than past the card. */}
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
              <dt className="text-muted-foreground">{t("plan")}</dt>
              <dd className="m-0">
                {plan ? <DateRange text={plan} /> : "—"}
                {soon !== null && soon >= 0 && soon <= 14 && (
                  <>
                    {" "}
                    <span className="whitespace-nowrap text-muted-foreground">· {t("inDays", { count: soon })}</span>
                  </>
                )}
              </dd>
              {actual && (
                <>
                  <dt className="text-muted-foreground">{t("actual")}</dt>
                  <dd className="m-0">
                    <DateRange text={actual} />
                  </dd>
                </>
              )}
            </dl>
            {timeline && chapter.state !== "pending" && <GanttBar chapter={chapter} timeline={timeline} today={today} className="min-w-0" />}
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
