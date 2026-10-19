"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, CircleCheck, Circle, Flag } from "lucide-react";
import type { ControlChapter, ControlMilestone, ObraError } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import FormError from "../../../../components/FormError";
import { daysBetween, spanDays, useControlFormat } from "./format";
import { MockBadge } from "./pills";

// Presentational: the dialogs that record a chapter's actual dates. Each is
// shown inside a Modal by the container; Cancel saves nothing.

/** A key–value row of a dialog's summary. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-t py-2 text-[13.5px] first:border-t-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function Footer({
  pending,
  submitLabel,
  disabled,
  onCancel,
}: {
  pending: boolean;
  submitLabel: string;
  disabled?: boolean;
  onCancel: () => void;
}) {
  const t = useTranslations("construction.dialogs");
  return (
    <div className="flex flex-col gap-3 border-t pt-3.5 md:flex-row md:items-center md:justify-between">
      <span className="text-[12.5px] text-muted-foreground">{t("cancelHint")}</span>
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending || disabled}>
          {pending ? t("saving") : submitLabel}
        </Button>
      </FormActions>
    </div>
  );
}

function DateField({
  id,
  label,
  value,
  max,
  onChange,
  hint,
  required = true,
}: {
  id: string;
  label: string;
  value: string;
  max: string;
  onChange: (value: string) => void;
  hint?: string;
  required?: boolean;
}) {
  return (
    <Field>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="date"
        className="num"
        value={value}
        max={max}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>}
    </Field>
  );
}

/** Pending → in progress: the day work really started (may be before today). */
export function StartDialog({
  chapter,
  planningMock,
  today,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  chapter: ControlChapter;
  /** The planned dates are simulated (no Planning baseline yet). */
  planningMock: boolean;
  today: string;
  pending: boolean;
  error?: ObraError;
  onSubmit: (date: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("construction.dialogs");
  const f = useControlFormat();
  const [date, setDate] = useState(today);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(date);
      }}
    >
      <p className="eyebrow">{t("chapterLabel", { code: chapter.code })}</p>
      <DateField id="start-date" label={t("actualStart")} value={date} max={today} onChange={setDate} hint={t("dateHint")} />
      {chapter.plannedStart && chapter.plannedEnd && (
        <div className="rounded-lg bg-raise px-3.5 py-2.5 text-[13px] text-muted-foreground">
          {t("planned", { start: f.day(chapter.plannedStart), end: f.day(chapter.plannedEnd) })}
          {date && chapter.plannedStart && daysBetween(chapter.plannedStart, date) !== 0 && (
            <span className="num ml-1.5">· {f.signedDays(daysBetween(chapter.plannedStart, date))}</span>
          )}
          {planningMock && (
            <span className="ml-2 inline-flex align-middle">
              <MockBadge />
            </span>
          )}
        </div>
      )}
      <p className="text-[13px] text-muted-foreground">{t("startEffect")}</p>
      <FormError namespace="obra.errors" error={error} />
      <Footer pending={pending} submitLabel={t("start")} disabled={!date} onCancel={onCancel} />
    </form>
  );
}

/** What finishing will do: the hito it completes and the invoice request it creates. */
export type FinishContext = {
  projectRef: string;
  projectAddress: string;
  clientName: string | null;
  milestone: ControlMilestone | null;
  /** Finishing this chapter completes the hito and asks for its invoice. */
  completes: boolean;
};

/** In progress → finished: the day work really finished; may complete its hito. */
export function FinishDialog({
  chapter,
  planningMock,
  context,
  today,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  chapter: ControlChapter;
  planningMock: boolean;
  context: FinishContext;
  today: string;
  pending: boolean;
  error?: ObraError;
  onSubmit: (date: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("construction.dialogs");
  const f = useControlFormat();
  const [date, setDate] = useState(today);
  const { milestone, completes } = context;
  const duration = chapter.actualStart && date ? spanDays(chapter.actualStart, date) : null;
  const delay = chapter.plannedEnd && date ? daysBetween(chapter.plannedEnd, date) : null;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(date);
      }}
    >
      <p className="eyebrow">{t("chapterLabel", { code: chapter.code })} · {context.projectRef}</p>
      <div className={cn("grid gap-4", completes && "md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]")}>
        <div className="flex flex-col gap-4">
          <DateField id="finish-date" label={t("actualEnd")} value={date} max={today} onChange={setDate} hint={t("dateHint")} />
          <div className="flex flex-col gap-1 text-[13px]">
            <span className="font-semibold">{t("result")}</span>
            <span className="text-muted-foreground">
              {chapter.actualStart && t("resultStart", { date: f.day(chapter.actualStart) })}
              {duration !== null && duration > 0 && <> · {t("duration", { days: duration })}</>}
            </span>
            {chapter.plannedStart && chapter.plannedEnd && (
              <span className="inline-flex flex-wrap items-center gap-1.5 text-muted-foreground">
                {t("planned", { start: f.day(chapter.plannedStart), end: f.day(chapter.plannedEnd) })}
                {delay !== null && (
                  <span className={cn("num font-semibold", delay > 0 ? "text-warn" : "text-good")}>
                    · {delay > 0 ? f.signedDays(delay) : t("onTime")}
                  </span>
                )}
                {planningMock && <MockBadge />}
              </span>
            )}
          </div>
        </div>

        {completes && milestone && (
          <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-brand-soft/60 p-3.5">
            <div className="flex items-start gap-2 text-brand-ink">
              <Flag aria-hidden className="mt-0.5 size-4 flex-none" />
              <b className="text-[14px]">{t("completes", { code: milestone.code, name: milestone.name })}</b>
            </div>
            <ul aria-label={t("milestoneChapters")} className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px]">
              {milestone.chapters.map((c) => (
                <li key={c.code} className="inline-flex items-center gap-1.5">
                  <CircleCheck aria-hidden className="size-4 text-good" />
                  <span className="num font-semibold">{c.code}</span>
                  <span className="text-muted-foreground">{c.code === chapter.code ? t("thisOne") : t("finished")}</span>
                </li>
              ))}
            </ul>
            <div className="rounded-lg bg-card px-3 py-1.5">
              <p className="eyebrow pt-1.5 pb-1">{t("requestTitle")}</p>
              <Row label={t("project")}>
                {context.projectRef} · {context.projectAddress}
              </Row>
              <Row label={t("client")}>{context.clientName ?? "—"}</Row>
              <Row label={t("concept")}>
                {t("conceptText", {
                  code: milestone.code,
                  name: milestone.name,
                  chapters: milestone.chapters.map((c) => c.code).join(", "),
                })}
              </Row>
              <Row label={t("amount")}>
                <span className="num">{f.money(milestone.amountCents)}</span>{" "}
                <span className="text-muted-foreground">· {f.share(milestone.pctBp)}</span>
              </Row>
            </div>
            <span className="text-[12.5px] text-muted-foreground">{t("onlyOnce")}</span>
          </div>
        )}
      </div>
      <FormError namespace="obra.errors" error={error} />
      <Footer pending={pending} submitLabel={completes ? t("finishAndRequest") : t("finish")} disabled={!date} onCancel={onCancel} />
    </form>
  );
}

/** After finishing: what was recorded and what happens next. */
export function FinishedNotice({
  chapter,
  planningMock,
  date,
  context,
  avanceHref,
  onClose,
}: {
  chapter: ControlChapter;
  planningMock: boolean;
  date: string;
  context: FinishContext;
  /** Set on pages other than Avance, to go back to it. */
  avanceHref?: string;
  onClose: () => void;
}) {
  const t = useTranslations("construction.dialogs");
  const f = useControlFormat();
  const duration = chapter.actualStart ? spanDays(chapter.actualStart, date) : null;

  return (
    <div role="status" className="flex flex-col gap-3.5">
      <div className="flex items-center gap-2.5">
        <CheckCircle2 aria-hidden className="size-6 text-good" />
        <span className="font-heading text-xl font-semibold">{t("finishedTitle", { code: chapter.code })}</span>
      </div>
      <div className="rounded-lg bg-raise px-3.5 py-1">
        <Row label={t("actualEnd")}>
          <span className="num">
            {f.fullDay(date)}
            {duration !== null && ` · ${t("duration", { days: duration })}`}
          </span>
        </Row>
        {context.completes && context.milestone && (
          <>
            <Row label={t("milestoneLabel", { code: context.milestone.code })}>
              <Badge variant="yel">{t("requested")}</Badge>
            </Row>
            <Row label={t("request")}>{t("requestWhere")}</Row>
          </>
        )}
        <Row label={t("planning")}>
          <span className="inline-flex items-center gap-1.5">
            {t("planningGets")} {planningMock && <MockBadge />}
          </span>
        </Row>
      </div>
      <FormActions>
        <Button type="button" variant={avanceHref ? "outline" : "default"} onClick={onClose}>
          {t("close")}
        </Button>
        {avanceHref && (
          <Link href={avanceHref} className={buttonVariants()}>
            {t("backToProgress")}
          </Link>
        )}
      </FormActions>
    </div>
  );
}

/**
 * Corrects recorded dates: either can be cleared (clearing the end reopens the
 * chapter; clearing the start too makes it pending). Only what changed is sent.
 */
export function CorrectDialog({
  chapter,
  today,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  chapter: ControlChapter;
  today: string;
  pending: boolean;
  error?: ObraError;
  onSubmit: (input: { actualStart?: string | null; actualEnd?: string | null; note?: string }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("construction.dialogs");
  const [start, setStart] = useState(chapter.actualStart ?? "");
  const [end, setEnd] = useState(chapter.actualEnd ?? "");
  const [note, setNote] = useState("");
  const startChanged = start !== (chapter.actualStart ?? "");
  const endChanged = end !== (chapter.actualEnd ?? "");

  function clearable(id: string, label: string, value: string, set: (v: string) => void) {
    return (
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <DateField id={id} label={label} value={value} max={today} onChange={set} required={false} />
        </div>
        <Button type="button" variant="ghost" onClick={() => set("")} disabled={!value} aria-label={t("clearLabel", { field: label })}>
          {t("clear")}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          ...(startChanged && { actualStart: start || null }),
          ...(endChanged && { actualEnd: end || null }),
          ...(note.trim() && { note: note.trim() }),
        });
      }}
    >
      <p className="eyebrow">{t("chapterLabel", { code: chapter.code })}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {clearable("correct-start", t("actualStart"), start, setStart)}
        {clearable("correct-end", t("actualEnd"), end, setEnd)}
      </div>
      <p className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
        <Circle aria-hidden className="mt-0.5 size-3 flex-none" />
        {t("clearHint")}
      </p>
      <Field>
        <Label htmlFor="correct-note">{t("note")}</Label>
        <Textarea id="correct-note" rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
        <FieldDescription>{t("noteHint")}</FieldDescription>
      </Field>
      <FormError namespace="obra.errors" error={error} />
      <Footer pending={pending} submitLabel={t("saveCorrection")} disabled={!startChanged && !endChanged} onCancel={onCancel} />
    </form>
  );
}
