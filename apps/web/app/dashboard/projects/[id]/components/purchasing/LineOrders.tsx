"use client";

// Presentational: a budget line's orders on the Compras by line, with their
// payment schedule, invoices and payments (LineTable opens them).

import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import {
  orderLabel,
  type OrderInvoicing,
  type PurchaseInvoiceListItem,
  type PurchaseLineItem,
  type PurchaseLineOrder,
  type PurchaseProgress,
} from "@repo/core/contract";
import { cn } from "@/lib/utils";
import { useVatLabel } from "../../../../components/vat-basis";
import { usePurchaseFormat } from "./format";
import { invoiceHref, orderHref } from "./links";
import {
  InvoiceStatePill,
  LatePill,
  ProgressPill,
  PurchaseKindPill,
  PurchaseStatusPill,
} from "./pills";
import { touchLink } from "../../../../components/touch";

/** A milestone's or invoice's row: concept, amount, state, invoices, payment (stacked on phones). */
const row =
  "grid items-center gap-x-3.5 gap-y-1 border-b px-3.5 py-2 text-sm last:border-b-0 max-md:grid-cols-2 md:grid-cols-[minmax(0,1fr)_110px_110px_150px_minmax(0,1fr)]";

/** What a milestone or invoice row says about its payment. */
function usePayText() {
  const t = useTranslations("purchasing.lines");
  const f = usePurchaseFormat();
  return {
    invoice: (invoice: PurchaseInvoiceListItem) => {
      if (invoice.kind === "credit_note" || invoice.state === "paid")
        return {
          text: invoice.kind === "credit_note" ? "" : t("payPaid"),
          tone: "text-good",
        };
      const date = f.date(invoice.dueOn);
      if (invoice.state === "overdue")
        return { text: t("payOverdue", { date }), tone: "text-bad" };
      if (invoice.state === "partial")
        return {
          text: t("payPartial", {
            paid: f.amount(invoice.paidCents),
            left: f.amount(invoice.outstandingCents),
            date,
          }),
          tone: "text-warn",
        };
      return { text: t("payPending", { date }), tone: "text-muted-foreground" };
    },
    progress: (
      progress: PurchaseProgress,
      invoicing: { outstandingCents: number; paidCents: number },
    ) => {
      if (progress === "paid")
        return { text: t("milestonePaid"), tone: "text-good" };
      if (progress === "contracted")
        return { text: t("toInvoice"), tone: "text-muted-foreground" };
      return {
        text:
          invoicing.outstandingCents > 0
            ? t("payLeft", {
                paid: f.amount(invoicing.paidCents),
                left: f.amount(invoicing.outstandingCents),
              })
            : t("toInvoice"),
        tone: "text-warn",
      };
    },
  };
}

function InvoiceLink({ invoice }: { invoice: { id: string; number: string } }) {
  return (
    <Link
      href={invoiceHref(invoice.id)}
      className={cn("num inline-flex items-center gap-1 font-semibold text-brand-ink hover:text-primary", touchLink)}
    >
      <FileText aria-hidden className="size-3.5 flex-none" />
      {invoice.number}
    </Link>
  );
}

/** An order's money, without VAT: invoiced, paid, owed, retained and still to invoice. */
export function InvoicingFoot({
  invoicing,
  className,
}: {
  invoicing: OrderInvoicing;
  className?: string;
}) {
  const t = useTranslations("purchasing.lines.foot");
  const f = usePurchaseFormat();
  const vat = useVatLabel();
  const items: [string, number, string?][] = [
    [t("invoiced"), invoicing.invoicedCents],
    [t("paid"), invoicing.paidCents, "text-good"],
    [
      t("outstanding"),
      invoicing.outstandingCents,
      invoicing.outstandingCents > 0 ? "text-warn" : undefined,
    ],
    ...(invoicing.retainedCents > 0
      ? ([[t("retained"), invoicing.retainedCents]] as [string, number][])
      : []),
    [t("toInvoice"), invoicing.toInvoiceCents],
  ];
  return (
    <p
      className={cn(
        "m-0 flex flex-wrap gap-x-5 gap-y-1 bg-raise px-3.5 py-2 text-meta",
        className,
      )}
    >
      <span className="text-muted-foreground">{vat(t("label"), "excl")}</span>
      {items.map(([label, cents, tone]) => (
        <span key={label}>
          {label} <b className={cn("num", tone)}>{f.amount(cents)}</b>
        </span>
      ))}
    </p>
  );
}

/** One order behind a line: its milestones (or, without them, its invoices) and its money. */
function LineOrderCard({
  projectId,
  order,
}: {
  projectId: string;
  order: PurchaseLineOrder;
}) {
  const t = useTranslations("purchasing.lines");
  const f = usePurchaseFormat();
  const pay = usePayText();
  const rows = order.milestones.length > 0;
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3.5 py-2.5 text-sm">
        <Link
          href={orderHref(projectId, order.id)}
          className={cn("num font-semibold text-brand-ink hover:text-primary", touchLink)}
        >
          {orderLabel(order.number)}
        </Link>
        <b className="min-w-0">{order.supplierName}</b>
        <PurchaseKindPill kind={order.kind} />
        <PurchaseStatusPill status={order.status} />
        {order.lateDays !== null && <LatePill days={order.lateDays} />}
        <span className="num ml-auto font-semibold">
          {f.amount(order.lineAmountCents)}
        </span>
      </div>
      <ul className="m-0 list-none p-0">
        {rows ? (
          order.milestones.map((m) => {
            const text = pay.progress(m.progress, m);
            return (
              <li key={m.id} className={row}>
                <span className="min-w-0 max-md:col-span-2">
                  <span aria-hidden className="mr-1 text-muted-foreground">
                    ↳
                  </span>
                  {m.concept}
                </span>
                <span className="num md:text-right">
                  {f.amount(m.amountCents)}
                </span>
                <span>
                  <ProgressPill progress={m.progress} />
                </span>
                <span className="flex min-w-0 flex-wrap gap-x-2">
                  {m.invoices.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    m.invoices.map((invoice) => (
                      <InvoiceLink key={invoice.id} invoice={invoice} />
                    ))
                  )}
                </span>
                <span className={cn("min-w-0 text-meta", text.tone)}>
                  {text.text}
                </span>
              </li>
            );
          })
        ) : order.invoices.length === 0 ? (
          <li className="px-3.5 py-2 text-sm text-muted-foreground">
            {t("noInvoices")}
          </li>
        ) : (
          order.invoices.map((invoice) => {
            const text = pay.invoice(invoice);
            return (
              <li key={invoice.id} className={row}>
                <span className="min-w-0 max-md:col-span-2">
                  <span aria-hidden className="mr-1 text-muted-foreground">
                    ↳
                  </span>
                  <InvoiceLink invoice={invoice} />{" "}
                  <span className="text-meta text-muted-foreground">
                    {f.date(invoice.issuedOn)}
                  </span>
                </span>
                <span className="num md:text-right">
                  {f.amount(invoice.baseCents)}
                </span>
                <span>
                  <InvoiceStatePill state={invoice.state} />
                </span>
                <span className="max-md:hidden" />
                <span className={cn("min-w-0 text-meta", text.tone)}>
                  {text.text}
                </span>
              </li>
            );
          })
        )}
      </ul>
      <InvoicingFoot invoicing={order.invoicing} />
    </div>
  );
}

/** A line's orders, or why it has none yet. */
export function LineDetail({
  projectId,
  line,
  orderBy,
  newOrderHref,
}: {
  projectId: string;
  line: PurchaseLineItem;
  orderBy: string | null;
  newOrderHref?: string;
}) {
  const t = useTranslations("purchasing.lines");
  const f = usePurchaseFormat();
  if (line.orders.length === 0) {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        {t("noOrders")} {orderBy && t("orderBy", { date: f.date(orderBy) })}{" "}
        {newOrderHref && (
          <Link
            href={newOrderHref}
            className={cn("font-semibold text-brand-ink hover:text-primary", touchLink)}
          >
            {t("createOrder")}
          </Link>
        )}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      {line.orders.map((order) => (
        <LineOrderCard key={order.id} projectId={projectId} order={order} />
      ))}
    </div>
  );
}
