"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PlanningCalendar } from "@repo/core/contract";
import { isCalendarDate, planCheck, planEnd, schedulePlan, templateItems } from "@repo/core/planning-calc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import CalendarFields from "./CalendarFields";
import { muted } from "../obra/classes";
import { bar, timelineSpanning } from "../construction/Gantt";
import { useControlFormat } from "../construction/format";

// Presentational: a project's first plan: when the works start, where the
// durations come from and the working calendar, with a preview of the
// standard plan. The container creates the draft.

export type GenerateInput = {
  from: "template" | "project";
  startDate: string;
  projectId?: string;
} & PlanningCalendar;

const choice =
  "flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2.5 has-[:checked]:border-primary has-[:checked]:bg-brand-soft";

export default function GeneratePlanForm({
  chapters,
  copyFrom,
  startDate,
  completionDate,
  today,
  pending,
  error,
  onSubmit,
}: {
  chapters: { code: string; name: string }[];
  copyFrom: { projectId: string; ref: string }[];
  /** The project's start date, if it has one. */
  startDate: string | null;
  completionDate: string | null;
  /** Nothing is placed before it, as the server does. */
  today: string;
  pending: boolean;
  error?: React.ReactNode;
  onSubmit: (input: GenerateInput) => void;
}) {
  const t = useTranslations("planning.generate");
  const tp = useTranslations("planning");
  const f = useControlFormat();
  const [start, setStart] = useState(startDate ?? "");
  const [from, setFrom] = useState<GenerateInput["from"]>("template");
  const [projectId, setProjectId] = useState(copyFrom[0]?.projectId ?? "");
  const [calendar, setCalendar] = useState<PlanningCalendar>({ region: null, augustClosure: true, christmasClosure: true });

  // The standard plan, as it would come out (a copy's durations are only known once made).
  const items = templateItems(chapters.map((c) => c.code));
  const dates = isCalendarDate(start) && from === "template" ? schedulePlan(items, { startDate: start, calendar, today }) : null;
  const end = dates && planEnd(dates);
  const margin = end && completionDate ? -(planCheck(end, completionDate, 0).delayDays ?? 0) : null;
  const timeline = dates && timelineSpanning([...dates.values()].flatMap((d) => [d.start, d.end]), start);

  return (
    <div className="flex flex-wrap items-start gap-[18px]">
      <form
        className={cn(cardVariants(), "min-w-0 flex-[1_1_320px] gap-4")}
        aria-labelledby="generate-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ from, startDate: start, ...calendar, ...(from === "project" ? { projectId } : {}) });
        }}
      >
        <h2 id="generate-title">{t("title")}</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-start">{t("start")}</Label>
          <Input id="plan-start" type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13.5px] font-medium">{t("from")}</legend>
          <label className={choice}>
            <input type="radio" name="from" className="mt-1 accent-primary" checked={from === "template"} onChange={() => setFrom("template")} />
            <span>
              <b>{t("template")}</b>
              <span className={cn(muted, "block")}>{t("templateHint")}</span>
            </span>
          </label>
          <label className={cn(choice, copyFrom.length === 0 && "cursor-not-allowed opacity-60")}>
            <input
              type="radio"
              name="from"
              className="mt-1 accent-primary"
              checked={from === "project"}
              disabled={copyFrom.length === 0}
              onChange={() => setFrom("project")}
            />
            <span>
              <b>{t("copy")}</b>
              <span className={cn(muted, "block")}>{copyFrom.length > 0 ? t("copyHint") : t("copyNone")}</span>
            </span>
          </label>
          {from === "project" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-copy">{t("copyProject")}</Label>
              <NativeSelect id="plan-copy" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {copyFrom.map((p) => (
                  <NativeSelectOption key={p.projectId} value={p.projectId}>
                    {p.ref}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-2 text-[13.5px] font-medium">{t("calendar")}</legend>
          <CalendarFields id="plan" calendar={calendar} onChange={(change) => setCalendar((c) => ({ ...c, ...change }))} />
        </fieldset>

        {error}
        <Button type="submit" disabled={pending || !isCalendarDate(start) || (from === "project" && !projectId)}>
          {t("submit")}
        </Button>
      </form>

      <section className={cn(cardVariants({ size: "flush" }), "min-w-0 flex-[999_1_480px] py-4")} aria-labelledby="preview-title">
        <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2 px-[18px] pb-3">
          <div>
            <h2 id="preview-title">{t("preview")}</h2>
            <p className={muted}>{from === "template" ? t("previewHint", { count: chapters.length }) : t("previewCopy")}</p>
          </div>
          {end && (
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col">
                <span className={muted}>{t("previewEnd")}</span>
                <span className="font-heading text-[24px] font-semibold">{f.fullDay(end)}</span>
              </div>
              {margin !== null && (
                <Badge variant={margin >= 0 ? "good" : "destructive"}>
                  {margin >= 0 ? tp("margin", { count: margin }) : t("over", { count: -margin })}
                </Badge>
              )}
            </div>
          )}
        </div>
        {dates && timeline ? (
          <ul className="m-0 list-none p-0">
            {items
              .filter((item) => !item.spansWorks)
              .map((item) => {
                const d = dates.get(item.code)!;
                const name = chapters.find((c) => c.code === item.code)?.name ?? item.code;
                return (
                  <li key={item.code} className="grid grid-cols-[36px_minmax(0,1fr)_92px] items-center gap-x-2.5 border-t px-[18px] py-1.5 text-[13px] sm:grid-cols-[36px_minmax(0,1fr)_100px_minmax(120px,1.2fr)]">
                    <span className="num font-semibold">{item.code}</span>
                    <span className="truncate">{name}</span>
                    <span className="num text-[12px] text-muted-foreground">
                      {f.day(d.start)} – {f.day(d.end)}
                    </span>
                    <span aria-hidden className="relative hidden h-2.5 rounded-[3px] bg-raise sm:block">
                      <span className="absolute inset-y-0 rounded-[3px] bg-primary" style={bar(timeline, d.start, d.end)} />
                    </span>
                  </li>
                );
              })}
          </ul>
        ) : (
          <p className={cn(muted, "px-[18px]")}>{from === "template" ? t("previewNeedsStart") : t("previewCopyHint")}</p>
        )}
      </section>
    </div>
  );
}
