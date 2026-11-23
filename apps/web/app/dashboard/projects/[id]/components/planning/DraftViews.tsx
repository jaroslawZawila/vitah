"use client";

import { createContext, use, useEffect, useRef } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
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
// approving. The container recomputes the dates as staff type. A chapter moves
// up and down the list by its arrows (one place) or dragged by its handle (any
// number, from 768px, with the mouse, a finger or the keyboard): the order is
// how the plan reads, the dates still come from the rules.

/** How a chapter's start is set, as the "starts after" select shows it. */
const FROM_START = "";
const FIXED = "fixed";

/** A chapter's two arrows: one place up the list, one down. */
const MOVES = [
  { by: -1, Icon: ArrowUp, label: "moveUp" },
  { by: 1, Icon: ArrowDown, label: "moveDown" },
] as const;
type MoveBy = (typeof MOVES)[number]["by"];

/** A drag starts once the pointer has moved a little (a click on the handle starts none). */
const POINTER = { activationConstraint: { distance: 4 } };
/** Or with Space on the handle, then the arrow keys and Space again. */
const KEYBOARD = { coordinateGetter: sortableKeyboardCoordinates };
/** A row moves up and down only. */
const VERTICAL = [restrictToVerticalAxis];

export type RuleChange = Partial<Pick<PlanningItemInput, "after" | "lagDays" | "durationDays" | "fixedStart" | "leadDays">>;

/**
 * Below 768px the table's rows become cards: the chapter on top, then each
 * field on a line of its own with its label (the table's heading) on the left.
 * One set of inputs serves both layouts.
 */
const phone = {
  table: "max-md:block max-md:[&_tbody]:block",
  row: "max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)] max-md:gap-x-3 max-md:gap-y-2 max-md:px-[18px] max-md:py-3.5 max-md:hover:bg-transparent",
  code: "max-md:p-0 max-md:pt-px",
  chapter: "max-md:min-w-0 max-md:p-0",
  field: "max-md:col-span-2 max-md:flex max-md:flex-wrap max-md:items-center max-md:justify-between max-md:gap-x-3 max-md:gap-y-1.5 max-md:p-0",
};

type RowProps = {
  code: string;
  /** What a screen reader calls the handle, after its name. */
  roleDescription: string;
  children: React.ReactNode;
};

/** A chapter's row for those who only look: nothing drags it. */
function StaticRow({ children }: RowProps) {
  return <TableRow className={phone.row}>{children}</TableRow>;
}

/** What a row gives its handle: the element it is dragged by, and what makes it one. */
type RowDrag = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners" | "setActivatorNodeRef">;
const RowDragContext = createContext<RowDrag | null>(null);

/**
 * A chapter's row, which its handle (`RowHandle`, anywhere inside) drags up
 * and down the list: the rows between make room as it passes.
 */
function SortableRow({ code, roleDescription, children }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: code,
    attributes: { roleDescription },
  });
  return (
    <TableRow
      ref={setNodeRef}
      // Computed as it is dragged: how far it has moved.
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(phone.row, isDragging && "relative z-10 bg-card shadow-card hover:bg-card")}
    >
      <RowDragContext value={{ attributes, listeners, setActivatorNodeRef }}>{children}</RowDragContext>
    </TableRow>
  );
}

/** The handle its row is dragged by. A table row only: a phone's cards move by their arrows. */
function RowHandle({ label }: { label: string }) {
  const drag = use(RowDragContext);
  if (!drag) return null;
  return (
    <Button
      ref={drag.setActivatorNodeRef}
      type="button"
      variant="ghost"
      size="icon-sm"
      className="cursor-grab touch-none active:cursor-grabbing max-md:hidden"
      aria-label={label}
      {...drag.attributes}
      {...drag.listeners}
    >
      <GripVertical aria-hidden />
    </Button>
  );
}

/** A field's heading, shown beside it on a phone (the input has its own label). */
function PhoneLabel({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden className="font-sans text-sm font-normal text-muted-foreground md:hidden">
      {children}
    </span>
  );
}

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
  onMove,
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
  /** Puts the chapter `code` where the chapter `toCode` is. */
  onMove: (code: string, toCode: string) => void;
}) {
  const t = useTranslations("planning.edit");
  const f = useControlFormat();
  const rowOf = new Map(rows.map((r) => [r.code, r]));
  const working = rules.filter((r) => !r.spansWorks);
  const spanning = rules.filter((r) => r.spansWorks);
  const end = dates ? [...dates.values()].map((d) => d.end).sort().at(-1) : null;

  // The arrow pressed keeps the focus as its row moves, so it can be pressed
  // again; at the end of the list, where it is disabled, its pair takes it.
  const section = useRef<HTMLElement>(null);
  const moved = useRef<{ code: string; by: MoveBy } | null>(null);
  useEffect(() => {
    const last = moved.current;
    if (!last) return;
    moved.current = null;
    const arrows = [...(section.current?.querySelectorAll<HTMLButtonElement>("button[data-move]:enabled") ?? [])].filter(
      (button) => button.dataset.move === last.code,
    );
    (last.by === -1 ? arrows[0] : arrows.at(-1))?.focus();
  }, [rules]);
  const step = (index: number, by: MoveBy) => {
    const [rule, other] = [working[index], working[index + by]];
    if (!rule || !other) return;
    moved.current = { code: rule.code, by };
    onMove(rule.code, other.code);
  };

  const sensors = useSensors(useSensor(PointerSensor, POINTER), useSensor(KeyboardSensor, KEYBOARD));
  const order = working.map((rule) => rule.code);
  // What a screen reader hears while a chapter is dragged: the chapter, and the place it is over.
  const said = (key: "dragStart" | "dragOver" | "dragEnd", code: UniqueIdentifier, at: UniqueIdentifier) =>
    t(key, { code: String(code), position: order.indexOf(String(at)) + 1, total: order.length });
  const cancelled = (code: UniqueIdentifier) => t("dragCancel", { code: String(code) });
  const announcements: Announcements = {
    onDragStart: ({ active }) => said("dragStart", active.id, active.id),
    onDragOver: ({ active, over }) => (over ? said("dragOver", active.id, over.id) : undefined),
    onDragEnd: ({ active, over }) => (over ? said("dragEnd", active.id, over.id) : cancelled(active.id)),
    onDragCancel: ({ active }) => cancelled(active.id),
  };
  const Row = readOnly ? StaticRow : SortableRow;

  const table = (
    <section ref={section} className={cn(cardVariants({ size: "flush" }), "min-w-0 py-1.5")} aria-label={t("tableLabel")}>
      <Table className={cn("md:min-w-[860px]", phone.table)}>
        <TableHeader className="max-md:hidden">
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
          {working.map((rule, index) => {
            const row = rowOf.get(rule.code);
            const finished = row?.state === "finished";
            const started = row?.state === "in_progress";
            const d = dates?.get(rule.code);
            const was = baseline?.ends[rule.code];
            const delta = d && was ? daysBetween(was, d.end) : null;
            const from = rule.after ?? (rule.fixedStart ? FIXED : FROM_START);
            return (
              <Row key={rule.code} code={rule.code} roleDescription={t("dragRole")}>
                <TableCell className={cn("num pl-[18px] font-semibold md:font-normal", phone.code)}>{rule.code}</TableCell>
                <TableCell className={cn("whitespace-normal", readOnly ? "min-w-[190px]" : "min-w-[310px]", phone.chapter)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold">{row?.name ?? rule.code}</div>
                      <div className={cn(muted, "flex flex-wrap items-center gap-1.5")}>
                        {finished
                          ? t("finished")
                          : started && row?.actualStart
                            ? t("inProgress", { date: f.date(row.actualStart) })
                            : row?.hitoCode}
                        {critical.has(rule.code) && <Badge variant="warn">{t("critical")}</Badge>}
                      </div>
                    </div>
                    {!readOnly && (
                      <div className="flex gap-0.5">
                        <RowHandle label={t("dragHandle", { code: rule.code })} />
                        {MOVES.map(({ by, Icon, label }) => (
                          <Button
                            key={by}
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            data-move={rule.code}
                            aria-label={t(label, { code: rule.code })}
                            disabled={working[index + by] === undefined}
                            onClick={() => step(index, by)}
                          >
                            <Icon aria-hidden />
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className={phone.field}>
                  <PhoneLabel>{t("after")}</PhoneLabel>
                  <NativeSelect
                    aria-label={t("afterLabel", { code: rule.code })}
                    className="w-[132px] max-md:w-44"
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
                <TableCell className={phone.field}>
                  <PhoneLabel>{t("lagOrDate")}</PhoneLabel>
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
                <TableCell className={phone.field}>
                  <PhoneLabel>{t("days")}</PhoneLabel>
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
                <TableCell className={cn("num whitespace-nowrap", phone.field)}>
                  <PhoneLabel>{t("dates")}</PhoneLabel>
                  {d ? `${f.date(d.start)} – ${f.date(d.end)}` : "—"}
                </TableCell>
                <TableCell className={phone.field}>
                  <PhoneLabel>{t("lead")}</PhoneLabel>
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
                      <span className="num text-meta whitespace-nowrap text-muted-foreground">
                        {t("orderBy", { date: f.date(orderByDate(d.start, rule.leadDays)) })}
                      </span>
                    )}
                  </div>
                </TableCell>
                {baseline && (
                  <TableCell
                    className={cn(
                      "num pr-[18px] text-right font-semibold",
                      phone.field,
                      delta === null ? "text-muted-foreground" : delta > 0 ? "text-warn" : delta < 0 ? "text-good" : "text-muted-foreground",
                    )}
                  >
                    <PhoneLabel>{t("vs", { number: baseline.number })}</PhoneLabel>
                    {was === undefined ? t("new") : delta === null ? "—" : delta === 0 ? t("same") : f.signedDays(delta)}
                  </TableCell>
                )}
              </Row>
            );
          })}
          {spanning.length > 0 && (
            <TableRow className="hover:bg-transparent max-md:block">
              <TableCell colSpan={baseline ? 8 : 7} className={cn(muted, "pl-[18px] whitespace-normal max-md:block max-md:px-[18px] max-md:py-3")}>
                {t("spans", {
                  codes: spanning.map((r) => `${r.code} ${rowOf.get(r.code)?.name ?? ""}`.trim()).join(" · "),
                  date: f.date(end),
                })}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </section>
  );

  // Nothing to drag for those who only look.
  if (readOnly) return table;
  return (
    <DndContext
      id="plan-chapters"
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={VERTICAL}
      // The page scrolls with the drag; the table's own sideways scroll stays put.
      autoScroll={{ threshold: { x: 0, y: 0.2 } }}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t("dragInstructions") } }}
      onDragEnd={({ active, over }) => over && active.id !== over.id && onMove(String(active.id), String(over.id))}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        {table}
      </SortableContext>
    </DndContext>
  );
}

/** Where the draft ends against the contract. */
export function DraftCheck({ check, problem }: { check: PlanningCheck | null; problem: React.ReactNode }) {
  const t = useTranslations("planning.edit.check");
  const f = useControlFormat();
  const delay = check?.delayDays ?? null;
  const late = delay !== null && delay > 0;
  const tone = late ? "text-warn" : "";
  const text = !check ? "" : delay === null ? t("noContract") : late ? t("late") : t("onTime");
  return (
    <section className={cn(cardVariants(), "gap-3", late && "border-warn/50")} aria-labelledby="check-title">
      <h2 id="check-title">{t("title")}</h2>
      {problem ?? (
        <>
          <dl className="m-0 grid grid-cols-2 gap-3">
            <div>
              <dt className={muted}>{t("end")}</dt>
              <dd className={cn("m-0 font-heading text-[26px] font-semibold", tone)}>{check ? f.date(check.endDate) : "—"}</dd>
            </div>
            <div>
              <dt className={muted}>{t("contract")}</dt>
              <dd className="m-0 font-heading text-[26px] font-semibold">{f.date(check?.contractEnd)}</dd>
            </div>
            <div className="col-span-2">
              <dt className={muted}>{t("delay")}</dt>
              <dd className={cn("num m-0 font-semibold", tone)}>
                {delay === null ? "—" : late ? t("days", { count: delay }) : t("inTime")}
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
      {saved && <p className="text-sm text-good" role="status">{t("saved")}</p>}
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
