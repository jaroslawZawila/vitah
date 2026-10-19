"use client";

import { useTranslations } from "next-intl";
import type { PlanningCalendar, PlanningCheck, PlanningItemInput, PlanningRow } from "@repo/core/contract";
import { orderByDate, type Dates } from "@repo/core/planning-calc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { muted } from "../obra/classes";
import { daysBetween, useControlFormat } from "../construction/format";
import CalendarFields from "./CalendarFields";

// Presentational: Obra › Planificación › Editar, a draft's rules (what each
// chapter waits for, its lag and working days) with the dates they give, and
// the panels beside it: the end against the contract, the calendar, and
// approving. The container recomputes the dates as staff type.

/** How a chapter's start is set, as the "starts after" select shows it. */
const FROM_START = "";
const FIXED = "fixed";

export type RuleChange = Partial<Pick<PlanningItemInput, "after" | "lagDays" | "durationDays" | "fixedStart" | "leadDays">>;

/** The draft's chapters: their rules (editable), and the dates and change against the baseline those give. */
export function DraftTable({
  rows,
  rules,
  dates,
  critical,
  baseline,
  startDate,
  readOnly,
  onChange,
}: {
  /** Names, hitos and what Avance recorded. */
  rows: PlanningRow[];
  rules: PlanningItemInput[];
  /** Null while the rules can't be scheduled (a cycle, a bad number). */
  dates: ReadonlyMap<string, Dates> | null;
  critical: ReadonlySet<string>;
  baseline: { number: number; ends: Record<string, string> } | null;
  /** The works' start: a fixed day's default while the rules can't be scheduled. */
  startDate: string;
  readOnly: boolean;
  onChange: (code: string, change: RuleChange) => void;
}) {
  const t = useTranslations("planning.edit");
  const f = useControlFormat();
  const rowOf = new Map(rows.map((r) => [r.code, r]));
  const working = rules.filter((r) => !r.spansWorks);
  const spanning = rules.filter((r) => r.spansWorks);
  const end = dates ? [...dates.values()].map((d) => d.end).sort().at(-1) : null;

  return (
    <section className={cn(cardVariants({ size: "flush" }), "min-w-0 py-1.5")} aria-label={t("tableLabel")}>
      <Table className="min-w-[860px] text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead className="pl-[18px]">{t("code")}</TableHead>
            <TableHead>{t("chapter")}</TableHead>
            <TableHead>{t("after")}</TableHead>
            <TableHead>{t("lagOrDate")}</TableHead>
            <TableHead>{t("days")}</TableHead>
            <TableHead>{t("dates")}</TableHead>
            <TableHead>{t("lead")}</TableHead>
            {baseline && <TableHead className="pr-[18px] text-right">{t("vs", { number: baseline.number })}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {working.map((rule) => {
            const row = rowOf.get(rule.code);
            const finished = row?.state === "finished";
            const started = row?.state === "in_progress";
            const d = dates?.get(rule.code);
            const was = baseline?.ends[rule.code];
            const delta = d && was ? daysBetween(was, d.end) : null;
            const from = rule.after ?? (rule.fixedStart ? FIXED : FROM_START);
            return (
              <TableRow key={rule.code}>
                <TableCell className="num pl-[18px]">{rule.code}</TableCell>
                <TableCell className="min-w-[190px] whitespace-normal">
                  <div className="font-semibold">{row?.name ?? rule.code}</div>
                  <div className={cn(muted, "flex flex-wrap items-center gap-1.5")}>
                    {finished
                      ? t("finished")
                      : started && row?.actualStart
                        ? t("inProgress", { date: f.day(row.actualStart) })
                        : row?.hitoCode}
                    {critical.has(rule.code) && <Badge variant="warn">{t("critical")}</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  <NativeSelect
                    aria-label={t("afterLabel", { code: rule.code })}
                    className="w-[132px]"
                    value={from}
                    disabled={readOnly || finished || started}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === FROM_START) onChange(rule.code, { after: null, fixedStart: null, lagDays: 0 });
                      else if (value === FIXED) onChange(rule.code, { after: null, lagDays: 0, fixedStart: d?.start ?? startDate });
                      else onChange(rule.code, { after: value, fixedStart: null });
                    }}
                  >
                    <NativeSelectOption value={FROM_START}>{t("fromStart")}</NativeSelectOption>
                    <NativeSelectOption value={FIXED}>{t("fixed")}</NativeSelectOption>
                    {working
                      .filter((other) => other.code !== rule.code)
                      .map((other) => (
                        <NativeSelectOption key={other.code} value={other.code}>
                          {t("afterCode", { code: other.code })}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                </TableCell>
                <TableCell>
                  {rule.after ? (
                    <Input
                      type="number"
                      aria-label={t("lagLabel", { code: rule.code })}
                      className="w-[76px] font-mono"
                      value={rule.lagDays}
                      disabled={readOnly || finished || started}
                      onChange={(e) => onChange(rule.code, { lagDays: Math.trunc(Number(e.target.value)) })}
                    />
                  ) : from === FIXED ? (
                    <Input
                      type="date"
                      aria-label={t("fixedLabel", { code: rule.code })}
                      className="w-[150px]"
                      value={rule.fixedStart ?? ""}
                      disabled={readOnly || finished || started}
                      onChange={(e) => e.target.value && onChange(rule.code, { fixedStart: e.target.value })}
                    />
                  ) : (
                    <span className={muted}>—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={1}
                    aria-label={t("daysLabel", { code: rule.code })}
                    className="w-[76px] font-mono"
                    value={rule.durationDays}
                    disabled={readOnly || finished}
                    onChange={(e) => onChange(rule.code, { durationDays: Math.trunc(Number(e.target.value)) })}
                  />
                </TableCell>
                <TableCell className="num whitespace-nowrap">{d ? `${f.day(d.start)} – ${f.day(d.end)}` : "—"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      aria-label={t("leadLabel", { code: rule.code })}
                      className="w-[68px] font-mono"
                      value={rule.leadDays}
                      disabled={readOnly || finished}
                      onChange={(e) => onChange(rule.code, { leadDays: Math.trunc(Number(e.target.value)) })}
                    />
                    {d && !finished && !started && (
                      <span className="num text-[12px] whitespace-nowrap text-muted-foreground">
                        {t("orderBy", { date: f.day(orderByDate(d.start, rule.leadDays)) })}
                      </span>
                    )}
                  </div>
                </TableCell>
                {baseline && (
                  <TableCell
                    className={cn(
                      "num pr-[18px] text-right font-semibold",
                      delta === null ? "text-muted-foreground" : delta > 0 ? "text-warn" : delta < 0 ? "text-good" : "text-muted-foreground",
                    )}
                  >
                    {was === undefined ? t("new") : delta === null ? "—" : delta === 0 ? t("same") : f.signedDays(delta)}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
          {spanning.length > 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={baseline ? 8 : 7} className={cn(muted, "pl-[18px] whitespace-normal")}>
                {t("spans", {
                  codes: spanning.map((r) => `${r.code} ${rowOf.get(r.code)?.name ?? ""}`.trim()).join(" · "),
                  date: end ? f.day(end) : "—",
                })}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </section>
  );
}

/** Where the draft ends against the contract, and what that would cost. */
export function DraftCheck({ check, problem }: { check: PlanningCheck | null; problem: React.ReactNode }) {
  const t = useTranslations("planning.edit.check");
  const f = useControlFormat();
  const delay = check?.delayDays ?? null;
  const tone = delay === null || delay <= 0 ? "" : delay > 14 ? "text-bad" : "text-warn";
  let text: string;
  if (!check) text = "";
  else if (delay === null) text = t("noContract");
  else if (delay <= 0) text = t("onTime");
  else if (delay <= 14) text = t("late", { count: 14 - delay });
  else text = t("penalized", { count: delay - 14 });
  return (
    <section
      className={cn(cardVariants(), "gap-3", delay !== null && delay > 0 && (delay > 14 ? "border-bad/50" : "border-warn/50"))}
      aria-labelledby="check-title"
    >
      <h2 id="check-title">{t("title")}</h2>
      {problem ?? (
        <>
          <dl className="m-0 grid grid-cols-2 gap-3">
            <div>
              <dt className={muted}>{t("end")}</dt>
              <dd className={cn("m-0 font-heading text-[26px] font-semibold", tone)}>{check ? f.fullDay(check.endDate) : "—"}</dd>
            </div>
            <div>
              <dt className={muted}>{t("contract")}</dt>
              <dd className="m-0 font-heading text-[26px] font-semibold">{check?.contractEnd ? f.fullDay(check.contractEnd) : "—"}</dd>
            </div>
            <div>
              <dt className={muted}>{t("delay")}</dt>
              <dd className={cn("num m-0 font-semibold", tone)}>
                {delay === null ? "—" : delay <= 0 ? t("inTime") : t("days", { count: delay })}
              </dd>
            </div>
            <div>
              <dt className={muted}>{t("penalty")}</dt>
              <dd className={cn("num m-0 font-semibold", check && check.penaltyCents > 0 && "text-bad")}>
                {f.moneyRound(check?.penaltyCents ?? 0)}
              </dd>
            </div>
          </dl>
          <p className={cn(muted, "leading-normal")}>{text}</p>
        </>
      )}
    </section>
  );
}

/** When the works start and which days are worked. */
export function CalendarCard({
  startDate,
  calendar,
  readOnly,
  onChange,
}: {
  startDate: string;
  calendar: PlanningCalendar;
  readOnly: boolean;
  onChange: (change: Partial<PlanningCalendar> & { startDate?: string }) => void;
}) {
  const t = useTranslations("planning.edit.calendar");
  return (
    <section className={cn(cardVariants(), "gap-3")} aria-labelledby="calendar-title">
      <h2 id="calendar-title">{t("title")}</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="draft-start">{t("start")}</Label>
        <Input
          id="draft-start"
          type="date"
          value={startDate}
          disabled={readOnly}
          onChange={(e) => e.target.value && onChange({ startDate: e.target.value })}
        />
      </div>
      <CalendarFields id="draft" calendar={calendar} disabled={readOnly} onChange={onChange} />
    </section>
  );
}

/** Approving (with the reason a change needs), saving and discarding the draft. */
export function ApproveCard({
  number,
  first,
  reason,
  pending,
  canApprove,
  error,
  saved,
  onReason,
  onApprove,
  onSave,
  onDiscard,
}: {
  number: number;
  /** The project's first plan: a note, not a reason, and it may stay empty. */
  first: boolean;
  reason: string;
  pending: boolean;
  canApprove: boolean;
  error?: React.ReactNode;
  saved: boolean;
  onReason: (reason: string) => void;
  onApprove: () => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations("planning.edit.approve");
  return (
    <section className={cn(cardVariants(), "gap-3")} aria-labelledby="approve-title">
      <h2 id="approve-title">{t("title")}</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="draft-reason">{first ? t("note") : t("reason")}</Label>
        <Textarea
          id="draft-reason"
          rows={3}
          value={reason}
          placeholder={t("placeholder")}
          onChange={(e) => onReason(e.target.value)}
        />
      </div>
      {error}
      {saved && <p className="text-[13px] text-good" role="status">{t("saved")}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="flex-auto" disabled={pending || !canApprove || (!first && !reason.trim())} onClick={onApprove}>
          {t("submit", { number })}
        </Button>
        <Button type="button" variant="outline" className="flex-auto" disabled={pending || !canApprove} onClick={onSave}>
          {t("save")}
        </Button>
      </div>
      <p className={cn(muted, "leading-normal")}>{t("who")}</p>
      <Button type="button" variant="ghost-destructive" className="w-fit" disabled={pending} onClick={onDiscard}>
        {t("discard")}
      </Button>
    </section>
  );
}
