"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import {
  PURCHASE_FLOWS,
  orderLabel,
  requestLabel,
  type PurchaseOrderDetail,
  type PurchaseStatus,
} from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DateRange } from "../../../../components/DateRange";
import FormError from "../../../../components/FormError";
import { companyHref } from "../../../../subcontratas/components/display";
import { ChapterStatePill } from "../construction/pills";
import { StageEyebrow } from "../construction/ObraFrame";
import { deviationTone } from "../construction/format";
import { day, usePurchaseFormat } from "./format";
import { requestHref } from "./links";
import { PurchaseKindPill, PurchaseStatusPill, SupplierCaePill } from "./pills";
import { touchLink } from "../../../../components/touch";
import { phoneLabel, phoneLine } from "../../../../components/phone-table";


// Presentational: an order's page (heading, late warning, status steps,
// lines, data and history). The container (OrderScreen) runs the actions.

/** "VTH-26-001 · PED-049", status and kind; the concept; the supplier. */
export function OrderHeading({ order, actions }: { order: PurchaseOrderDetail; actions?: React.ReactNode }) {
  const t = useTranslations("purchasing.order");
  const ty = useTranslations("subcontractors.fields.types");
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <StageEyebrow label={`${order.projectRef} · ${orderLabel(order.number)}`} />
          <PurchaseStatusPill status={order.status} />
          <PurchaseKindPill kind={order.kind} />
        </div>
        <h1 className="mt-1.5 [overflow-wrap:anywhere]">{order.description}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] text-muted-foreground">
          <Link href={companyHref(order.subcontractorId)} className={cn("font-semibold text-brand-ink hover:text-primary", touchLink)}>
            {order.supplierName}
          </Link>
          <span>· {order.suppliesOnly ? ty("supplier.label") : t("subcontractor")}</span>
          {!order.suppliesOnly && order.caeStatus && order.caeStatus !== "apta" && (
            <SupplierCaePill suppliesOnly={false} status={order.caeStatus} />
          )}
          {order.request && (
            <span>
              ·{" "}
              {t.rich("fromRequest", {
                number: requestLabel(order.request.number),
                link: (chunks) => (
                  <Link href={requestHref(order.projectId, order.request!.id)} className="num font-semibold text-brand-ink hover:text-primary">
                    {chunks}
                  </Link>
                ),
              })}
            </span>
          )}
        </p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** A material order past its expected delivery: a warning only, with a way to log it as an issue. */
export function LateBanner({ order, issuesHref }: { order: PurchaseOrderDetail; issuesHref: string }) {
  const t = useTranslations("purchasing.order");
  const f = usePurchaseFormat();
  if (order.lateDays === null) return null;
  const running = order.chapters.filter((c) => c.state === "in_progress").map((c) => c.code);
  return (
    <div role="status" className="flex flex-wrap items-start gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3.5 text-sm text-warn">
      <Clock aria-hidden className="mt-0.5 size-5 flex-none" />
      <p className="m-0 min-w-0 flex-[1_1_320px]">
        <b>{t("late.title", { days: order.lateDays })}</b>{" "}
        {t("late.expected", { date: f.date(order.expectedOn) })}{" "}
        {running.length > 0 && t("late.running", { count: running.length, codes: running.join(", ") })}{" "}
        {t("late.onlyWarning")}
      </p>
      <Link href={issuesHref} className={cn("font-semibold whitespace-nowrap underline", touchLink)}>
        {t("late.recordIssue")}
      </Link>
    </div>
  );
}

/** The day an order's status changed (delivered, finished…) and an optional note; never after today. */
export function StatusForm({
  title,
  hint,
  dateLabel,
  confirmLabel,
  today,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  title: string;
  hint: string;
  dateLabel: string;
  confirmLabel: string;
  today: string;
  pending: boolean;
  error?: string;
  onSubmit: (values: { date: string; note: string }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("purchasing.order");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  return (
    <form
      aria-labelledby="status-form-title"
      className={cn(cardVariants(), "border-primary/40")}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ date, note });
      }}
    >
      <div>
        <h2 id="status-form-title" className="text-[22px]">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field>
          <Label htmlFor="status-date">{dateLabel}</Label>
          <Input id="status-date" type="date" required value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field>
          <Label htmlFor="status-note">{t("note")}</Label>
          <Input id="status-note" value={note} maxLength={500} placeholder={t("notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <FormError namespace="purchasing.errors" error={error} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : confirmLabel}
        </Button>
      </FormActions>
    </form>
  );
}

/** The kind's flow as steps: done, the current one, and those to come (the last with its planned day). */
export function StatusSteps({ order }: { order: PurchaseOrderDetail }) {
  const t = useTranslations("purchasing");
  const f = usePurchaseFormat();
  const flow: readonly PurchaseStatus[] = PURCHASE_FLOWS[order.kind];
  const { reached } = order;
  const current = flow.indexOf(order.status);
  const planned = order.kind === "material" ? order.expectedOn : order.workEnd;
  const last = flow.length - 1;

  return (
    <section className={cardVariants()} aria-label={t("order.steps")}>
      <ol
        className="m-0 grid list-none gap-2 p-0 sm:grid-cols-[repeat(var(--steps),minmax(0,1fr))]"
        style={{ "--steps": flow.length } as React.CSSProperties}
      >
        {flow.map((status, index) => {
          const done = current === -1 ? status in reached : index < current || (index === current && index === last);
          const now = index === current && index !== last;
          const date = (current === -1 || index <= current) && reached[status];
          return (
            <li
              key={status}
              className="grid min-w-0 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3 sm:flex sm:flex-col sm:items-stretch sm:gap-1.5"
              aria-current={index === current ? "step" : undefined}
            >
              <span aria-hidden className="relative block h-1 overflow-hidden rounded-full bg-border">
                {(done || now) && <span className={cn("absolute inset-y-0 left-0 bg-primary", now ? "w-1/2" : "w-full")} />}
              </span>
              <b className="text-sm [overflow-wrap:anywhere]">{t(`status.${status}`)}</b>
              <span className="num text-meta whitespace-normal text-muted-foreground">
                {date
                  ? f.date(date)
                  : index === last && planned && current !== -1
                    ? t("order.plannedOn", { date: f.date(planned) })
                    : ""}
              </span>
            </li>
          );
        })}
      </ol>
      {order.status === "cancelled" && (
        <p className="text-sm text-bad">
          {t("order.cancelledOn", { date: f.date(reached.cancelled) })}
        </p>
      )}
    </section>
  );
}

/**
 * Below 768px a table of figures reflows into one block per row (the same
 * elements): the line on top, then each figure on its own row with its column's
 * name, which the table says in its hidden heading.
 */
const phone = {
  block: "max-md:block",
  row: "max-md:grid max-md:grid-cols-[52px_minmax(0,1fr)] max-md:gap-x-2 max-md:gap-y-1 max-md:px-[18px] max-md:py-2.5",
  cell: `max-md:col-start-2 ${phoneLine}`,
  label: phoneLabel,
};

/** The order's lines against the budget's cost, with what other orders add and the deviation once closed. */
export function OrderLines({ order }: { order: PurchaseOrderDetail }) {
  const t = useTranslations("purchasing.order.lines");
  const f = usePurchaseFormat();
  const anyClosed = order.lines.some((l) => l.deviationCents !== null);

  return (
    <section className={cn(cardVariants({ size: "flush" }), "pt-4 pb-2.5")} aria-labelledby="lines-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5 px-[18px] pb-2.5">
        <h2 id="lines-title" className="text-[22px]">
          {t("title")}
        </h2>
        <span className="text-meta text-muted-foreground">
          {order.budgetNumber !== null ? t("atCostRevision", { number: order.budgetNumber }) : t("atCost")}
        </span>
      </div>
      <Table className={cn(phone.block, "md:min-w-[760px]")}>
        <TableHeader className="max-md:hidden">
          <TableRow>
            <TableHead className="pl-[18px]">{t("line")}</TableHead>
            <TableHead>{t("description")}</TableHead>
            <TableHead className="text-right">{t("cost")}</TableHead>
            <TableHead className="text-right">{t("others")}</TableHead>
            <TableHead className="text-right">{t("this")}</TableHead>
            <TableHead>{t("closes")}</TableHead>
            <TableHead className="pr-[18px] text-right">{t("deviation")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className={phone.block}>
          {order.lines.map((line) => (
            <TableRow key={line.id} className={phone.row}>
              <TableCell className="num pl-[18px] max-md:p-0">{line.code ?? "—"}</TableCell>
              <TableCell className="min-w-[240px] whitespace-normal max-md:min-w-0 max-md:p-0">
                {line.description ?? <span className="text-muted-foreground">{t("gone")}</span>}
                {line.quantity !== null && (
                  <span className="num text-meta text-muted-foreground">
                    {" "}
                    {f.decimal(line.quantity)} {line.unit}
                  </span>
                )}
              </TableCell>
              <TableCell className={cn("num text-right", phone.cell)}>
                <span className={phone.label}>{t("cost")}</span>
                {line.costCents === null ? "—" : f.amount(line.costCents)}
              </TableCell>
              <TableCell className={cn("num text-right text-muted-foreground", phone.cell, !line.otherCents && "max-md:hidden")}>
                <span className={phone.label}>{t("others")}</span>
                {line.otherCents ? f.amount(line.otherCents) : "—"}
              </TableCell>
              <TableCell className={cn("num text-right font-semibold", phone.cell)}>
                <span className={phone.label}>{t("this")}</span>
                {f.amount(line.amountCents)}
              </TableCell>
              <TableCell className={phone.cell}>
                <span className={phone.label}>{t("closes")}</span>
                <Badge variant={line.closesLine ? "default" : "outline"}>{line.closesLine ? t("yes") : t("no")}</Badge>
              </TableCell>
              <TableCell className={cn("num pr-[18px] text-right", deviationTone(line.deviationCents), phone.cell)}>
                <span className={phone.label}>{t("deviation")}</span>
                {line.deviationCents === null ? (
                  <span className="font-sans text-meta text-muted-foreground">{t("open")}</span>
                ) : (
                  <span className={deviationTone(line.deviationCents)}>
                    {f.signedAmount(line.deviationCents)}
                    {line.deviationBp !== null && <span className="text-meta"> ({f.signedPercent(line.deviationBp)})</span>}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter className={phone.block}>
          <TableRow className="hover:bg-transparent max-md:flex max-md:items-center max-md:justify-between max-md:gap-3 max-md:px-[18px] max-md:py-2.5">
            <TableCell colSpan={4} className="pl-[18px] max-md:p-0">
              {t("total")}
            </TableCell>
            <TableCell className="num text-right max-md:p-0">{f.amount(order.amountCents)}</TableCell>
            <TableCell colSpan={2} className="pr-[18px] max-md:hidden" />
          </TableRow>
        </TableFooter>
      </Table>
      <p className="mx-[18px] mt-2.5 text-meta leading-normal text-muted-foreground">{anyClosed ? t("closedNote") : t("openNote")}</p>
    </section>
  );
}

/** Dates, chapters, payment terms and who created it. */
export function OrderData({
  order,
  editHref,
}: {
  order: PurchaseOrderDetail;
  /** "Cambiar" beside the dates; omitted for viewers. */
  editHref?: string;
}) {
  const t = useTranslations("purchasing.order.data");
  const tv = useTranslations("purchasing.vat");
  const f = usePurchaseFormat();
  const material = order.kind === "material";
  const works =
    order.workStart || order.workEnd ? `${f.date(order.workStart)} – ${f.date(order.workEnd)}` : "—";
  const change = editHref && (
    <Link href={editHref} className={cn("ml-1.5 inline-block text-meta font-medium text-brand-ink hover:text-primary", touchLink)}>
      {t("change")}
    </Link>
  );
  const rows: [string, React.ReactNode, boolean?][] = [
    [t("orderedOn"), f.date(order.orderedOn), true],
    // Not a `num` row: "Cambiar" goes under the dates when the card is narrow.
    material
      ? [t("expectedOn"), <><span className="num">{f.date(order.expectedOn)}</span>{change}</>]
      : [t("works"), <><DateRange text={works} />{change}</>],
    [material ? t("deliveredOn") : t("finishedOn"), f.date(order.completedOn), true],
    [
      order.chapters.length === 1 ? t("chapter") : t("chapters"),
      order.chapters.length === 0 ? (
        "—"
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {order.chapters.map((c) => (
            <li key={c.code} className="flex flex-wrap items-center gap-1.5">
              <span className="num">{c.code}</span> {c.name} <ChapterStatePill state={c.state} />
            </li>
          ))}
        </ul>
      ),
    ],
    [t("paymentTerms"), t("paymentDays", { days: order.terms.paymentDays })],
    [t("retention"), order.terms.retentionBp > 0 ? t("retentionValue", { pct: f.share(order.terms.retentionBp) }) : t("noRetention")],
    [t("vat"), tv(order.terms.vatKind)],
    ...(order.notes ? ([[t("notes"), <span key="notes" className="whitespace-pre-line">{order.notes}</span>]] as [string, React.ReactNode][]) : []),
    [t("createdBy"), `${order.createdBy ?? "—"} · ${f.date(day(order.createdAt))}`],
  ];

  return (
    <section className={cn(cardVariants(), "@container")} aria-labelledby="data-title">
      <h2 id="data-title" className="text-[22px]">
        {t("title")}
      </h2>
      {/* In a narrow column (the side column at 1024px), each value goes under its label. */}
      <dl className="m-0 grid gap-x-3.5 gap-y-1 text-sm @[17rem]:grid-cols-[minmax(0,130px)_minmax(0,1fr)] @[17rem]:gap-y-2.5">
        {rows.map(([label, value, num]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={cn("m-0 min-w-0 [overflow-wrap:anywhere]", num && "num")}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
