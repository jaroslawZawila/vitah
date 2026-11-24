"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ConstructionControl, ControlChapter } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DateRange } from "../../../../components/DateRange";
import { cardTop, chapterLink, footnote, moreLink, totalRow } from "./classes";
import { stretchedLink } from "../../../../components/touch";
import { deviationTone, useControlFormat, type ControlFormat } from "./format";
import { ChapterStatePill, SCHEDULE_TONE, Source, SourceLabel } from "./pills";
import { scheduleOf } from "./schedule";

/** "14/09 – 09/10", "21/09 – …" or "—". */
export function dateSpan(f: ControlFormat, start: string | null, end: string | null) {
  if (!start && !end) return null;
  return `${start ? f.date(start) : "…"} – ${end ? f.date(end) : "…"}`;
}

/** Presentational: `dateSpan` in a table cell, breaking after the dash when the column is narrow. */
export function DateSpan({ f, start, end }: { f: ControlFormat; start: string | null; end: string | null }) {
  const text = dateSpan(f, start, end);
  return text ? <DateRange text={text} /> : <Dash />;
}

/** Presentational: a chapter's schedule against its plan, as a pill (or a muted note). */
export function SchedulePill({ chapter, today, long = false }: { chapter: ControlChapter; today: string; long?: boolean }) {
  const t = useTranslations("construction.schedule");
  const f = useControlFormat();
  const schedule = scheduleOf(chapter, today);
  if (!schedule) return null;
  // In the table, a start passed says it short: the pill would widen the Plazo column past the card.
  const key = long ? (schedule.key === "overdue" ? "overdueLong" : schedule.key) : schedule.key === "notStarted" ? "notStartedShort" : schedule.key;
  const label = t(key, {
    days: f.signedDays(schedule.days),
    count: schedule.days,
  });
  if (schedule.key === "startsIn") return <span className="text-meta text-muted-foreground">{label}</span>;
  return <Badge variant={SCHEDULE_TONE[schedule.tone]}>{label}</Badge>;
}

/** Presentational: the deviation of what was contracted, "+440" over "+1,4 %" (stacked, to keep the column narrow), or "—". */
export function Deviation({ cents, bp }: { cents: number | null; bp: number | null }) {
  const f = useControlFormat();
  if (cents === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("num", deviationTone(cents))}>
      {f.signedAmount(cents)}
      {bp !== null && <span className="block">{f.signedPercent(bp)}</span>}
    </span>
  );
}

/**
 * Presentational: the Resumen's chapters as one list in their order, each
 * with its state, plan vs actual dates, cost and contract deviation.
 */
export default function SummaryTable({
  chapters,
  control,
  chapterHref,
  progressHref,
}: {
  /** The chapters to show (already filtered). */
  chapters: ControlChapter[];
  control: ConstructionControl;
  chapterHref: (code: string) => string;
  progressHref: string;
}) {
  const t = useTranslations("construction.summary.table");
  const ts = useTranslations("construction.sources");
  const f = useControlFormat();
  const { today, sources, cost } = control;

  const totals: ChapterTotals = chapters.reduce(
    (sum, c) => ({
      cost: sum.cost + c.costCents,
      contracted: sum.contracted + (c.contractedCents ?? 0),
      contractedCost: sum.contractedCost + c.contractedCostCents,
      deviation: sum.deviation + (c.deviationCents ?? 0),
    }),
    { cost: 0, contracted: 0, contractedCost: 0, deviation: 0 },
  );

  return (
    <section className={cn(cardVariants({ size: "flush" }), "pt-[18px] pb-1.5")} aria-labelledby="chapters-title">
      <div className={cn(cardTop, "px-[18px] pb-3")}>
        <h2 id="chapters-title" className="text-2xl">
          {t("title")}
        </h2>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          <SourceLabel>
            {t("planDates")} <Source name={ts("planning")} mock={sources.planning === "mock"} />
          </SourceLabel>
          <SourceLabel>
            {t("actualDates")} <Source name={ts("planning")} />
          </SourceLabel>
          <SourceLabel>
            {t("contractedFrom")} <Source name={ts("purchasing")} />
          </SourceLabel>
          <Link href={progressHref} className={moreLink}>
            {t("recordProgress")} →
          </Link>
        </div>
      </div>
      {chapters.length === 0 ? (
        <p className="px-[18px] py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table className="hidden min-w-[900px] md:table" aria-labelledby="chapters-title">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-[18px]">{t("chapter")}</TableHead>
              <TableHead>{t("state")}</TableHead>
              <TableHead>{t("plan")}</TableHead>
              <TableHead>{t("actual")}</TableHead>
              <TableHead>{t("schedule")}</TableHead>
              <TableHead>{t("hito")}</TableHead>
              <TableHead className="text-right whitespace-normal">{t("cost")}</TableHead>
              <TableHead className="text-right">{t("contracted")}</TableHead>
              <TableHead className="pr-[18px] text-right">{t("deviation")}</TableHead>
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
                </TableCell>
                <TableCell>
                  <ChapterStatePill state={chapter.state} />
                </TableCell>
                <TableCell><DateSpan f={f} start={chapter.plannedStart} end={chapter.plannedEnd} /></TableCell>
                <TableCell><DateSpan f={f} start={chapter.actualStart} end={chapter.actualEnd} /></TableCell>
                <TableCell>
                  <SchedulePill chapter={chapter} today={today} />
                </TableCell>
                <TableCell className="num">{chapter.hitoCode ?? <Dash />}</TableCell>
                <TableCell className="num text-right">{f.amount(chapter.costCents)}</TableCell>
                <TableCell className="text-right">
                  {chapter.contractedCents === null ? (
                    <Dash />
                  ) : (
                    <span className="num">
                      {f.amount(chapter.contractedCents)}
                      {chapter.contractedLines < chapter.lineCount && (
                        <span className="text-muted-foreground" title={t("contractedLines", { contracted: chapter.contractedLines, total: chapter.lineCount })}>
                          {" "}
                          {chapter.contractedLines}/{chapter.lineCount}
                        </span>
                      )}
                    </span>
                  )}
                </TableCell>
                <TableCell className="pr-[18px] text-right">
                  <Deviation cents={chapter.deviationCents} bp={chapter.deviationBp} />
                </TableCell>
              </TableRow>
            ))}
            <TableRow className={totalRow}>
              <TableCell colSpan={6} className="pl-[18px]">{t("total", { count: chapters.length })}</TableCell>
              <TableCell className="num text-right">{f.amount(totals.cost)}</TableCell>
              <TableCell className="num text-right">{f.amount(totals.contracted)}</TableCell>
              <TableCell className="pr-[18px] text-right">
                <TotalDeviation totals={totals} />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
      {chapters.length > 0 && <SummaryChapterList chapters={chapters} today={today} totals={totals} chapterHref={chapterHref} />}
      <p className={cn(footnote, "px-[18px] pt-2.5 pb-3")}>
        {t("footnote", { contingency: f.amount(cost.contingencyCents) })}
      </p>
    </section>
  );
}

export const Dash = () => <span className="text-muted-foreground">—</span>;

type ChapterTotals = { cost: number; contracted: number; contractedCost: number; deviation: number };

/** The total's deviation over what its closed lines were budgeted at; a dash until one is closed. */
function TotalDeviation({ totals }: { totals: ChapterTotals }) {
  if (!totals.contractedCost) return <Dash />;
  return <Deviation cents={totals.deviation} bp={Math.round((totals.deviation * 10_000) / totals.contractedCost)} />;
}

/** A label over its figure, in a phone list's two-column grid (a `dl`). */
export function Figure({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col items-start gap-0.5", className)}>
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

/**
 * Below 768px, the table as a list: per chapter its name (linking to its
 * page, over the whole item) and state, then its dates, schedule, hito and
 * money labelled, two to a row; the total at the foot.
 */
function SummaryChapterList({
  chapters,
  today,
  totals,
  chapterHref,
}: {
  chapters: ControlChapter[];
  today: string;
  totals: ChapterTotals;
  chapterHref: (code: string) => string;
}) {
  const t = useTranslations("construction.summary.table");
  const f = useControlFormat();

  return (
    <div className="md:hidden">
      <ul className="m-0 list-none p-0">
        {chapters.map((chapter) => (
          <li key={chapter.code} className="relative flex flex-col gap-2 border-t px-[18px] py-3">
            <div className="flex items-start gap-2.5">
              <span className="num pt-px text-muted-foreground">{chapter.code}</span>
              <Link href={chapterHref(chapter.code)} className={cn("min-w-0 flex-1 leading-snug font-semibold", stretchedLink)}>
                {chapter.name}
              </Link>
              <ChapterStatePill state={chapter.state} />
            </div>
            {(scheduleOf(chapter, today) || chapter.hitoCode) && (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-muted-foreground">
                <SchedulePill chapter={chapter} today={today} />
                {chapter.hitoCode && (
                  <span>
                    {t("hito")} <span className="num">{chapter.hitoCode}</span>
                  </span>
                )}
              </div>
            )}
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
              <dt className="text-muted-foreground">{t("plan")}</dt>
              <dd className="m-0">
                <DateSpan f={f} start={chapter.plannedStart} end={chapter.plannedEnd} />
              </dd>
              {(chapter.actualStart || chapter.actualEnd) && (
                <>
                  <dt className="text-muted-foreground">{t("actual")}</dt>
                  <dd className="m-0">
                    <DateSpan f={f} start={chapter.actualStart} end={chapter.actualEnd} />
                  </dd>
                </>
              )}
            </dl>
            <dl className="m-0 grid grid-cols-2 gap-x-3 text-sm">
              <Figure label={t("cost")}>
                <span className="num">{f.amount(chapter.costCents)}</span>
              </Figure>
              <Figure label={t("contracted")}>
                {chapter.contractedCents === null ? (
                  <Dash />
                ) : (
                  <span>
                    <span className="num">{f.amount(chapter.contractedCents)}</span>
                    {chapter.contractedLines < chapter.lineCount && (
                      <>
                        {" "}
                        <span className="num text-meta text-muted-foreground" title={t("contractedLines", { contracted: chapter.contractedLines, total: chapter.lineCount })}>
                          {chapter.contractedLines}/{chapter.lineCount}
                        </span>
                      </>
                    )}
                  </span>
                )}
                {/* The deviation under what it is of, its % breaking to the next line on a narrow phone. */}
                {chapter.deviationCents !== null && (
                  <span className={cn("block text-meta", deviationTone(chapter.deviationCents))}>
                    <span className="sr-only">{t("deviation")} </span>
                    <span className="num">{f.signedAmount(chapter.deviationCents)}</span>
                    {chapter.deviationBp !== null && (
                      <>
                        {" "}
                        <span className="num">· {f.signedPercent(chapter.deviationBp)}</span>
                      </>
                    )}
                  </span>
                )}
              </Figure>
            </dl>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2.5 border-t-2 border-t-foreground px-[18px] py-3 text-sm">
        <p className="font-bold">{t("total", { count: chapters.length })}</p>
        <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2.5 [&_dd]:font-bold">
          <Figure label={t("cost")}>
            <span className="num">{f.amount(totals.cost)}</span>
          </Figure>
          <Figure label={t("contracted")}>
            <span className="num">{f.amount(totals.contracted)}</span>
          </Figure>
          <Figure label={t("deviation")}>
            <TotalDeviation totals={totals} />
          </Figure>
        </dl>
      </div>
    </div>
  );
}
