"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import {
  PURCHASE_FLOWS,
  isCompletedOrder,
  orderLabel,
  requestLabel,
  type PurchaseOrderDetail,
  type PurchaseOrderEvent,
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
import FormError from "../../../../components/FormError";
import { companyHref } from "../../../../subcontratas/components/display";
import { ChapterStatePill } from "../construction/pills";
import { StageEyebrow } from "../construction/ObraFrame";
import { deviationTone } from "../construction/format";
import { day, usePurchaseFormat } from "./format";
import { requestHref } from "./links";
import { PurchaseKindPill, PurchaseStatusPill, SupplierCaePill } from "./pills";

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
          <Link href={companyHref(order.subcontractorId)} className="font-semibold text-brand-ink hover:text-primary">
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
    <div role="status" className="flex flex-wrap items-start gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3.5 text-[13.5px] text-warn">
      <Clock aria-hidden className="mt-0.5 size-5 flex-none" />
      <p className="m-0 min-w-0 flex-[1_1_320px]">
        <b>{t("late.title", { days: order.lateDays })}</b>{" "}
        {t("late.expected", { date: order.expectedOn ? f.shortDay(order.expectedOn) : "—" })}{" "}
        {running.length > 0 && t("late.running", { count: running.length, codes: running.join(", ") })}{" "}
        {t("late.onlyWarning")}
      </p>
      <Link href={issuesHref} className="font-semibold whitespace-nowrap underline">
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
        <p className="mt-1 text-[13px] text-muted-foreground">{hint}</p>
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
      <ol className="m-0 grid list-none gap-2 p-0" style={{ gridTemplateColumns: `repeat(${flow.length}, minmax(0, 1fr))` }}>
        {flow.map((status, index) => {
          const done = current === -1 ? status in reached : index < current || (index === current && index === last);
          const now = index === current && index !== last;
          const date = (current === -1 || index <= current) && reached[status];
          return (
            <li key={status} className="flex min-w-0 flex-col gap-1.5" aria-current={index === current ? "step" : undefined}>
              <span aria-hidden className="relative block h-1 overflow-hidden rounded-full bg-border">
                {(done || now) && <span className={cn("absolute inset-y-0 left-0 bg-primary", now ? "w-1/2" : "w-full")} />}
              </span>
              <b className="text-[13px] [overflow-wrap:anywhere]">{t(`status.${status}`)}</b>
              <span className="num text-[12px] text-muted-foreground">
                {date
                  ? f.shortDay(date)
                  : index === last && planned && current !== -1
                    ? t("order.plannedOn", { date: f.shortDay(planned) })
                    : ""}
              </span>
            </li>
          );
        })}
      </ol>
      {order.status === "cancelled" && (
        <p className="text-[13px] text-bad">
          {t("order.cancelledOn", { date: reached.cancelled ? f.shortDay(reached.cancelled) : "—" })}
        </p>
      )}
    </section>
  );
}

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
        <span className="text-[12.5px] text-muted-foreground">
          {order.budgetNumber !== null ? t("atCostRevision", { number: order.budgetNumber }) : t("atCost")}
        </span>
      </div>
      <Table className="min-w-[760px] text-[13px]">
        <TableHeader>
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
        <TableBody>
          {order.lines.map((line) => (
            <TableRow key={line.id}>
              <TableCell className="num pl-[18px]">{line.code ?? "—"}</TableCell>
              <TableCell className="min-w-[240px] whitespace-normal">
                {line.description ?? <span className="text-muted-foreground">{t("gone")}</span>}
                {line.quantity !== null && (
                  <span className="num text-[12px] text-muted-foreground">
                    {" "}
                    {f.decimal(line.quantity)} {line.unit}
                  </span>
                )}
              </TableCell>
              <TableCell className="num text-right">{line.costCents === null ? "—" : f.amount(line.costCents)}</TableCell>
              <TableCell className="num text-right text-muted-foreground">{line.otherCents ? f.amount(line.otherCents) : "—"}</TableCell>
              <TableCell className="num text-right font-semibold">{f.amount(line.amountCents)}</TableCell>
              <TableCell>
                <Badge variant={line.closesLine ? "default" : "outline"}>{line.closesLine ? t("yes") : t("no")}</Badge>
              </TableCell>
              <TableCell className={cn("num pr-[18px] text-right", deviationTone(line.deviationCents))}>
                {line.deviationCents === null ? (
                  <span className="font-sans text-[12px] text-muted-foreground">{t("open")}</span>
                ) : (
                  <>
                    {f.signedDecimal(line.deviationCents)}
                    {line.deviationBp !== null && <span className="text-[12px]"> ({f.signedPct(line.deviationBp)})</span>}
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={4} className="pl-[18px]">
              {t("total")}
            </TableCell>
            <TableCell className="num text-right">{f.amount(order.amountCents)}</TableCell>
            <TableCell colSpan={2} className="pr-[18px]" />
          </TableRow>
        </TableFooter>
      </Table>
      <p className="mx-[18px] mt-2.5 text-[12.5px] leading-normal text-muted-foreground">{anyClosed ? t("closedNote") : t("openNote")}</p>
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
  const date = (value: string | null) => (value ? f.date(value) : "—");
  const works =
    order.workStart || order.workEnd ? `${date(order.workStart)} – ${date(order.workEnd)}` : "—";
  const change = editHref && (
    <Link href={editHref} className="ml-1.5 font-sans text-[12.5px] font-medium text-brand-ink hover:text-primary">
      {t("change")}
    </Link>
  );
  const rows: [string, React.ReactNode, boolean?][] = [
    [t("orderedOn"), date(order.orderedOn), true],
    material
      ? [t("expectedOn"), <>{date(order.expectedOn)}{change}</>, true]
      : [t("works"), <>{works}{change}</>, true],
    [material ? t("deliveredOn") : t("finishedOn"), date(order.completedOn), true],
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
    [t("createdBy"), `${order.createdBy ?? "—"} · ${f.shortDay(day(order.createdAt))}`],
  ];

  return (
    <section className={cardVariants()} aria-labelledby="data-title">
      <h2 id="data-title" className="text-[22px]">
        {t("title")}
      </h2>
      <dl className="m-0 grid grid-cols-[minmax(0,130px)_minmax(0,1fr)] gap-x-3.5 gap-y-2.5 text-[13.5px]">
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

const FIELD_DATES = new Set(["orderedOn", "expectedOn", "workStart", "workEnd", "issuedOn", "dueOn", "neededBy"]);

/** One history entry (an order's, or the parts a purchase request shares with it), in words. */
export function EventText({ event }: { event: PurchaseOrderEvent }) {
  const t = useTranslations("purchasing.history");
  const ts = useTranslations("purchasing.status");
  const tk = useTranslations("purchasing.kind");
  const tv = useTranslations("purchasing.vat");
  const f = usePurchaseFormat();
  const d = event.detail;
  const num = (value: unknown) => (typeof value === "number" ? value : 0);
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const shown = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return "—";
    if (FIELD_DATES.has(key)) return f.shortDay(String(value));
    if (key === "kind") return tk(String(value) as "material");
    if (key === "vatKind") return tv(String(value) as "vat21");
    if (key === "retentionBp" || key === "irpfBp") return f.share(Number(value));
    if (key === "baseCents") return f.amount(Number(value));
    return String(value);
  };

  switch (event.action) {
    case "created":
      return <>{t("created", { count: num(d.lines), amount: f.amount(num(d.amountCents)) })}</>;
    case "status": {
      const from = text(d.from);
      const to = text(d.to);
      const label = <b>{`${from ? ts(from as PurchaseStatus) : "—"} → ${to ? ts(to as PurchaseStatus) : "—"}`}</b>;
      const completed = to !== "" && isCompletedOrder(to as PurchaseStatus);
      return (
        <>
          {label}
          {completed && typeof d.date === "string" && t(to === "delivered" ? "deliveredOn" : "finishedOn", { date: f.shortDay(d.date) })}
        </>
      );
    }
    case "updated": {
      const fields = (d.fields ?? {}) as Record<string, { from: unknown; to: unknown }>;
      return (
        <>
          {Object.entries(fields).map(([key, change], index) => (
            <span key={key}>
              {index > 0 && " · "}
              {key === "subcontractorId" || key === "notes"
                ? t(`changed.${key}`)
                : t("field", {
                    field: t.has(`fields.${key}`) ? t(`fields.${key}`) : key,
                    from: shown(key, change.from),
                    to: shown(key, change.to),
                  })}
            </span>
          ))}
        </>
      );
    }
    case "lines": {
      type Shape = { amountCents: number; closesLine: boolean } | null;
      const changes = (Array.isArray(d.changes) ? d.changes : []) as { code: string | null; from: Shape; to: Shape }[];
      return (
        <>
          {changes.map((change, index) => {
            const code = change.code ?? "—";
            let line: string;
            if (!change.from && change.to) line = t("lineAdded", { code, amount: f.amount(change.to.amountCents) });
            else if (change.from && !change.to) line = t("lineRemoved", { code });
            else if (change.from && change.to && change.from.amountCents !== change.to.amountCents)
              line = t("lineAmount", { code, from: f.amount(change.from.amountCents), to: f.amount(change.to.amountCents) });
            else line = t(change.to?.closesLine ? "lineCloses" : "lineReopens", { code });
            return (
              <span key={`${code}-${index}`}>
                {index > 0 && " · "}
                {line}
              </span>
            );
          })}
        </>
      );
    }
    case "amended":
      return (
        <>
          {t("amended", { number: num(d.number), amount: f.signedDecimal(num(d.deltaCents)) })}
          {typeof d.concept === "string" && <span className="text-muted-foreground"> “{d.concept}”</span>}
        </>
      );
    case "invoice_created":
      return <>{t(d.kind === "credit_note" ? "creditCreated" : "invoiceCreated", { number: text(d.number), amount: f.amount(num(d.baseCents)) })}</>;
    case "invoice_updated": {
      const fields = (d.fields ?? {}) as Record<string, { from: unknown; to: unknown }>;
      return (
        <>
          {t("invoiceUpdated", { number: text(d.number) })}
          {Object.entries(fields)
            .filter(([key]) => key !== "notes" && key !== "milestoneId")
            .map(([key, change]) => (
              <span key={key}>
                {" · "}
                {t("field", { field: t.has(`fields.${key}`) ? t(`fields.${key}`) : key, from: shown(key, change.from), to: shown(key, change.to) })}
              </span>
            ))}
        </>
      );
    }
    case "invoice_deleted":
      return <>{t("invoiceDeleted", { number: text(d.number) })}</>;
    case "invoice_file_added":
      return <>{t("invoiceFileAdded", { number: text(d.number), version: num(d.version) })}</>;
    case "payment_added":
      return <>{t("paymentAdded", { number: text(d.number), amount: f.amount(num(d.amountCents)) })}</>;
    case "payment_deleted":
      return <>{t("paymentDeleted", { number: text(d.number), amount: f.amount(num(d.amountCents)) })}</>;
    case "milestones":
      return <>{t("milestones", { count: Array.isArray(d.to) ? d.to.length : 0 })}</>;
    case "document_added":
      return <>{t("documentAdded", { title: text(d.title) })}</>;
    case "document_version_added":
      return <>{t("documentVersionAdded", { title: text(d.title), version: num(d.version) })}</>;
    case "document_removed":
      return <>{t("documentRemoved", { title: text(d.title) })}</>;
    case "file_added":
      return <>{t("fileAdded", { name: text(d.name) })}</>;
    case "file_removed":
      return <>{t("fileRemoved", { name: text(d.name) })}</>;
    default:
      return <>{event.action}</>;
  }
}

/** Every change to the order (or to a request, with its own `Text`), newest first. */
export function OrderHistory({
  events,
  Text = EventText,
}: {
  events: PurchaseOrderEvent[];
  Text?: (props: { event: PurchaseOrderEvent }) => React.ReactNode;
}) {
  const t = useTranslations("purchasing.history");
  const f = usePurchaseFormat();
  return (
    <section className={cardVariants()} aria-labelledby="history-title">
      <h2 id="history-title" className="text-[22px]">
        {t("title")}
      </h2>
      {events.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {events.map((event) => (
            <li key={event.id} className="grid gap-x-4 gap-y-0.5 border-b py-2.5 text-[13.5px] last:border-b-0 sm:grid-cols-[110px_minmax(0,1fr)]">
              <span className="num text-[12.5px] text-muted-foreground">{f.date(day(event.at))}</span>
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <Text event={event} />
                {event.note && <span className="text-muted-foreground"> “{event.note}”</span>}
                {event.by && <span className="text-muted-foreground"> · {event.by}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
