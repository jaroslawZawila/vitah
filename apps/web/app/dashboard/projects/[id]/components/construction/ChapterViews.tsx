"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Circle, CircleCheck, CircleDot } from "lucide-react";
import type {
  ChapterState,
  ControlChapter,
  ControlChapterDetail,
  ControlMilestone,
  ObraError,
  ProjectPhoto,
} from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import FormError from "../../../../components/FormError";
import { pctInput } from "../obra/classes";
import ProgressBar from "../obra/ProgressBar";
import { cardTop, footnote, kv, moreLink } from "./classes";
import { deviationTone, useControlFormat } from "./format";
import { MilestoneStatePill, Source, SourceLabel } from "./pills";

// Presentational: the cards of a chapter's page under Avance.

/** Plan against actual: start, end and duration, with "Corregir" for editors once started. */
export function DatesCard({
  chapter,
  planningMock,
  onCorrect,
}: {
  chapter: ControlChapter;
  planningMock: boolean;
  /** Omitted for viewers, or before the chapter started. */
  onCorrect?: () => void;
}) {
  const t = useTranslations("construction.chapter");
  const ts = useTranslations("construction.sources");
  const f = useControlFormat();
  const delay = (days: number | null) =>
    days !== null && days !== 0 && (
      <span className={cn("ml-1.5", days > 0 ? "text-warn" : "text-good")}>{f.signedDays(days)}</span>
    );

  return (
    <section className={cn(cardVariants(), "gap-3")} aria-labelledby="dates-title">
      <div className={cardTop}>
        <h2 id="dates-title">{t("dates")}</h2>
        {onCorrect && (
          <Button type="button" variant="ghost" size="sm" className="text-brand-ink" onClick={onCorrect}>
            {t("correct")}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13.5px]">
        <span />
        <span className="eyebrow">{t("plan")}</span>
        <span className="eyebrow">{t("actual")}</span>

        <span className="text-muted-foreground">{t("startRow")}</span>
        <span className="num">{chapter.plannedStart ? f.fullDay(chapter.plannedStart) : "—"}</span>
        <span className="num">
          {chapter.actualStart ? f.fullDay(chapter.actualStart) : <span className="text-muted-foreground">{t("notRecorded")}</span>}
          {delay(chapter.startDelayDays)}
        </span>

        <span className="text-muted-foreground">{t("endRow")}</span>
        <span className="num">{chapter.plannedEnd ? f.fullDay(chapter.plannedEnd) : "—"}</span>
        <span className="num">
          {chapter.actualEnd ? f.fullDay(chapter.actualEnd) : <span className="text-muted-foreground">{t("notRecorded")}</span>}
          {delay(chapter.endDelayDays)}
        </span>

        <span className="text-muted-foreground">{t("durationRow")}</span>
        <span className="num">{chapter.plannedDays !== null ? t("days", { days: chapter.plannedDays }) : "—"}</span>
        <span className="num">
          {chapter.actualDays === null
            ? "—"
            : chapter.state === "finished"
              ? t("days", { days: chapter.actualDays })
              : t("daysSoFar", { days: chapter.actualDays })}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <SourceLabel>
          {t("planFrom")} <Source name={ts("planning")} mock={planningMock} />
        </SourceLabel>
        <SourceLabel>{t("actualFrom")}</SourceLabel>
      </div>
    </section>
  );
}

const CHECK: Record<ChapterState, React.ReactNode> = {
  finished: <CircleCheck aria-hidden className="size-4 flex-none text-good" />,
  in_progress: <CircleDot aria-hidden className="size-4 flex-none text-primary" />,
  pending: <Circle aria-hidden className="size-4 flex-none text-muted-foreground" />,
};

/** The hito this chapter closes: its amount and every chapter it waits for. */
export function MilestoneCard({
  milestone,
  code,
  completes,
  actualEnd,
  paymentsHref,
}: {
  milestone: ControlMilestone;
  /** This chapter. */
  code: string;
  /** Finishing this chapter completes the hito. */
  completes: boolean;
  /** When each chapter of the hito finished, if known. */
  actualEnd: (code: string) => string | null;
  paymentsHref: string;
}) {
  const t = useTranslations("construction.chapter");
  const tc = useTranslations("construction.chapterState");
  const f = useControlFormat();
  const missing = milestone.chapters.filter((c) => c.state !== "finished").length;

  return (
    <section className={cn(cardVariants(), "gap-2.5")} aria-labelledby="milestone-title">
      <div className={cardTop}>
        <h2 id="milestone-title">
          {t("milestone")} <span className="num">{milestone.code}</span> · {milestone.name}
        </h2>
        <MilestoneStatePill state={milestone.state} />
      </div>
      <div className={kv}>
        <span className="text-muted-foreground">{t("ofContract", { pct: f.share(milestone.pctBp) })}</span>
        <span className="num">{f.money(milestone.amountCents)}</span>
      </div>
      <ul className="m-0 flex list-none flex-col p-0" aria-label={t("milestoneChapters", { code: milestone.code })}>
        {milestone.chapters.map((c) => {
          const end = actualEnd(c.code);
          return (
            <li key={c.code} className="flex min-h-10 items-center gap-2.5 border-t text-[13.5px] first:border-t-0">
              {CHECK[c.state]}
              <span className="num font-semibold">{c.code}</span>
              <span className="min-w-0 flex-1 truncate">{c.code === code ? t("thisChapter") : c.name}</span>
              <span className="num text-[12.5px] text-muted-foreground">
                {c.state === "finished" && end ? t("endedOn", { date: f.day(end) }) : tc(c.state).toLowerCase()}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="rounded-lg bg-raise px-3 py-2 text-[13px]">
        {completes
          ? t("lastOne", { code: milestone.code })
          : milestone.state === "pending"
            ? t("missing", { count: missing, code: milestone.code })
            : milestone.request
              ? t("requestedOn", { code: milestone.code, date: f.stampDay(milestone.request.requestedAt) })
              : t("reached", { code: milestone.code })}
      </p>
      <Link href={paymentsHref} className={moreLink}>
        {t("inPayments")} →
      </Link>
    </section>
  );
}

/** Budgeted cost against what was contracted for this chapter. */
export function CostCard({
  chapter,
  budgetNumber,
  costsHref,
}: {
  chapter: ControlChapter;
  budgetNumber: number | null;
  costsHref: string;
}) {
  const t = useTranslations("construction.chapter");
  const ts = useTranslations("construction.sources");
  const f = useControlFormat();
  const bp = chapter.deviationBp;

  return (
    <section className={cn(cardVariants(), "gap-1.5")} aria-labelledby="cost-title">
      <div className={cardTop}>
        <h2 id="cost-title">{t("cost")}</h2>
        <Link href={costsHref} className={moreLink}>
          {t("seeLines")} →
        </Link>
      </div>
      <div className={kv}>
        <span className="text-muted-foreground">{t("budgeted")}</span>
        <span className="num">{f.money(chapter.costCents)}</span>
      </div>
      <div className={kv}>
        <span className="text-muted-foreground">
          {t("contracted")}{" "}
          <span className="text-[12px]">
            {`· ${t("contractedLines", { closed: chapter.contractedLines, total: chapter.lineCount })}${
              chapter.openLines > 0 ? ` · ${t("openLines", { count: chapter.openLines })}` : ""
            }`}
          </span>
        </span>
        <span className="num">{chapter.contractedCents === null ? <span className="text-muted-foreground">{t("notContracted")}</span> : f.money(chapter.contractedCents)}</span>
      </div>
      <div className={kv}>
        <span className="font-semibold">{t("deviation")}</span>
        <span className={cn("num font-semibold", deviationTone(chapter.deviationCents))}>
          {chapter.deviationCents === null ? "—" : `${f.signedMoney(chapter.deviationCents)}${bp !== null ? ` · ${f.signedPct(bp)}` : ""}`}
        </span>
      </div>
      {chapter.contractedLines > 0 && (
        <p className={footnote}>
          {t("deviationOn", { count: chapter.contractedLines, amount: f.moneyRound(chapter.contractedCostCents) })}
        </p>
      )}
      <SourceLabel>
        {ts("budget")} {budgetNumber !== null && t("revision", { number: budgetNumber })} ·{" "}
        <Source name={ts("purchasing")} />
      </SourceLabel>
    </section>
  );
}

/** The chapter's latest photos. */
export function ChapterPhotos({
  photos,
  href,
  thumbUrl,
  fullUrl,
}: {
  photos: ProjectPhoto[];
  href: string;
  thumbUrl: (photo: ProjectPhoto) => string;
  fullUrl: (photo: ProjectPhoto) => string;
}) {
  const t = useTranslations("construction.chapter");
  const f = useControlFormat();
  return (
    <section className={cn(cardVariants(), "gap-3")} aria-labelledby="chapter-photos">
      <div className={cardTop}>
        <h2 id="chapter-photos">
          {t("photos")} <span className="num text-muted-foreground">{photos.length}</span>
        </h2>
        <Link href={href} className={moreLink}>
          {t("seeAll")} →
        </Link>
      </div>
      {photos.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("noPhotos")}</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3">
          {photos.slice(0, 6).map((photo) => {
            const caption = [f.day(photo.takenOn), photo.caption].filter(Boolean).join(" · ");
            return (
              <li key={photo.id} className="flex min-w-0 flex-col gap-1">
                <a href={fullUrl(photo)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg bg-raise">
                  {/* Served by our authenticated API, so next/image can't optimise it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumbUrl(photo)} alt={caption} loading="lazy" className="block aspect-[4/3] w-full object-cover" />
                </a>
                <span className="truncate text-[11.5px] text-muted-foreground">{caption}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Each line's executed %, which the client's app shows as the chapter's
 * progress. A finished chapter counts as 100 % there, so its inputs are off.
 */
export function LineProgressCard({
  lines,
  values,
  finished,
  canEdit,
  dirty,
  pending,
  saved,
  error,
  onChange,
  onSave,
}: {
  lines: ControlChapterDetail["lines"];
  /** The % as edited. */
  values: Record<string, number>;
  finished: boolean;
  canEdit: boolean;
  dirty: boolean;
  pending: boolean;
  saved: boolean;
  error?: ObraError;
  onChange: (lineId: string, pct: number) => void;
  onSave: () => void;
}) {
  const t = useTranslations("construction.chapter");
  const disabled = !canEdit || finished;

  return (
    <section className={cn(cardVariants(), "gap-3")} aria-labelledby="lines-title">
      <div className={cardTop}>
        <h2 id="lines-title">{t("lineProgress")}</h2>
        {canEdit && !finished && (
          <Button type="button" onClick={onSave} disabled={pending || !dirty}>
            {pending ? t("saving") : t("saveProgress")}
          </Button>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">{finished ? t("lineProgressFinished") : t("lineProgressHint")}</p>
      {lines.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("noLines")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {lines.map((line) => {
            const pct = finished ? 100 : (values[line.id] ?? line.executedPct);
            return (
              <li key={line.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t py-2 text-[13.5px] first:border-t-0">
                <span className="num w-14 flex-none text-muted-foreground">{line.code}</span>
                <span className="min-w-0 flex-[1_1_240px] leading-snug">
                  {line.description} <span className="text-muted-foreground">· {line.unit}</span>
                </span>
                <span className="flex flex-[0_1_220px] items-center gap-2.5">
                  <span className={pctInput.root}>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      inputMode="numeric"
                      className={pctInput.input}
                      aria-label={t("executedLabel", { code: line.code })}
                      value={pct}
                      disabled={disabled}
                      onChange={(event) => {
                        const next = Math.round(Number(event.target.value));
                        onChange(line.id, Number.isFinite(next) ? Math.min(100, Math.max(0, next)) : 0);
                      }}
                    />
                    <span className={pctInput.sign} aria-hidden>
                      %
                    </span>
                  </span>
                  <ProgressBar pct={pct} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <FormError namespace="obra.errors" error={error} />
      {saved && (
        <FormMessage role="status" tone="success">
          {t("saved")}
        </FormMessage>
      )}
    </section>
  );
}
