"use client";

import Link from "next/link";
import { useId } from "react";
import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { DUE_SOON_DAYS, orderLabel, type PurchaseInvoiceListItem, type PurchasePayment, type TenantInvoices, type TenantPayments } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import Kpi from "../../projects/[id]/components/obra/Kpi";
import { daysBetween } from "../../projects/[id]/components/construction/format";
import { usePurchaseFormat } from "../../projects/[id]/components/purchasing/format";
import { invoiceHref, orderHref, paymentFileUrl } from "../../projects/[id]/components/purchasing/links";
import { InvoiceStatePill } from "../../projects/[id]/components/purchasing/pills";

// Presentational: Compras › Facturas (the figures and the list) and Compras ›
// Pagos (the forecast and the payments). The containers filter and act.

/** What is owed, past due and due soon, and what was paid this month. */
export function InvoiceKpis({ summary }: { summary: TenantInvoices["summary"] }) {
  const t = useTranslations("purchasing.invoices.kpis");
  const f = usePurchaseFormat();
  return (
    <section aria-label={t("label")} className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      <Kpi
        label={t("outstanding")}
        value={f.moneyRound(summary.outstandingCents)}
        hints={[t("outstandingHint", { count: summary.outstandingInvoices, suppliers: summary.outstandingSuppliers })]}
      />
      <Kpi
        label={t("overdue")}
        value={<span className={summary.overdueCents > 0 ? "text-bad" : undefined}>{f.moneyRound(summary.overdueCents)}</span>}
        hints={[t("countHint", { count: summary.overdueInvoices })]}
        className={summary.overdueCents > 0 ? "border-bad/40" : undefined}
      />
      <Kpi
        label={t("dueSoon")}
        value={<span className={summary.dueSoonCents > 0 ? "text-warn" : undefined}>{f.moneyRound(summary.dueSoonCents)}</span>}
        hints={[t("countHint", { count: summary.dueSoonInvoices })]}
        className={summary.dueSoonCents > 0 ? "border-warn/40" : undefined}
      />
      <Kpi
        label={t("paidMonth")}
        value={<span className="text-good">{f.moneyRound(summary.paidThisMonthCents)}</span>}
        hints={[t("paidMonthHint", { count: summary.paymentsThisMonth })]}
      />
    </section>
  );
}

/** "en 3 días", "hace 4 días", "pagada"…: an invoice's due date in words. */
function DueNote({ invoice, today }: { invoice: PurchaseInvoiceListItem; today: string }) {
  const t = useTranslations("purchasing");
  const ti = useTranslations("purchasing.invoices");
  if (invoice.kind === "credit_note") {
    return invoice.rectifiesNumber ? <>{ti("rectifies", { number: invoice.rectifiesNumber })}</> : null;
  }
  if (invoice.state === "paid") return <>{ti("paidOn")}</>;
  if (!invoice.dueOn) return null;
  if (invoice.overdueDays !== null) return <span className="text-bad">{t("overdueFor", { days: invoice.overdueDays })}</span>;
  const days = daysBetween(today, invoice.dueOn);
  return <span className={days <= DUE_SOON_DAYS ? "text-warn" : undefined}>{t("dueIn", { days })}</span>;
}

/** The invoices, owed first; each linked to its page, its order and its obra. */
export function InvoiceTable({
  invoices,
  today,
  empty,
}: {
  invoices: PurchaseInvoiceListItem[];
  today: string;
  empty: string;
}) {
  const t = useTranslations("purchasing.invoices.cols");
  const f = usePurchaseFormat();
  if (invoices.length === 0) return <p className="px-[18px] py-6 text-center text-[13.5px] text-muted-foreground">{empty}</p>;
  return (
    <Table className="min-w-[1040px] text-[13px]">
      <TableHeader>
        <TableRow>
          <TableHead className="pl-[18px]">{t("dueOn")}</TableHead>
          <TableHead>{t("number")}</TableHead>
          <TableHead>{t("supplier")}</TableHead>
          <TableHead>{t("order")}</TableHead>
          <TableHead className="text-right">{t("base")}</TableHead>
          <TableHead className="text-right">{t("payable")}</TableHead>
          <TableHead className="text-right">{t("outstanding")}</TableHead>
          <TableHead className="pr-[18px]">{t("state")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((invoice) => (
          <TableRow key={invoice.id}>
            <TableCell className="pl-[18px]">
              <span className="num">{invoice.dueOn ? f.shortDay(invoice.dueOn) : "—"}</span>
              <span className="block text-[12px] text-muted-foreground">
                <DueNote invoice={invoice} today={today} />
              </span>
            </TableCell>
            <TableCell>
              <Link href={invoiceHref(invoice.id)} className="num font-semibold text-brand-ink hover:text-primary">
                {invoice.number}
              </Link>
            </TableCell>
            <TableCell className="whitespace-normal">{invoice.supplierName}</TableCell>
            <TableCell className="whitespace-normal">
              <span className="num">{invoice.projectRef}</span>{" "}
              <Link href={orderHref(invoice.projectId, invoice.orderId)} className="text-muted-foreground hover:text-primary">
                · {orderLabel(invoice.orderNumber)}
                {invoice.milestoneConcept && ` · ${invoice.milestoneConcept}`}
              </Link>
            </TableCell>
            <TableCell className="num text-right">{f.amount(invoice.baseCents)}</TableCell>
            <TableCell className="num text-right">{f.amount(invoice.payableCents)}</TableCell>
            <TableCell className="num text-right font-semibold">
              {invoice.kind === "credit_note" ? "—" : f.amount(Math.max(0, invoice.outstandingCents))}
            </TableCell>
            <TableCell className="pr-[18px]">
              <InvoiceStatePill state={invoice.state} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** What falls due each week (past due first), invoice by invoice. */
export function PaymentForecast({ forecast }: { forecast: TenantPayments["forecast"] }) {
  const t = useTranslations("purchasing.payments");
  const f = usePurchaseFormat();
  const weeks = forecast.filter((week) => week.from !== null || week.invoices.length > 0);
  return (
    <section className={cardVariants()} aria-labelledby="forecast-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="forecast-title" className="text-[22px]">
          {t("forecastTitle")}
        </h2>
        <span className="text-[12.5px] text-muted-foreground">{t("forecastHint")}</span>
      </div>
      <ul className="m-0 list-none p-0">
        {weeks.map((week) => (
          <li key={week.from ?? "overdue"} className="grid gap-x-4 gap-y-1.5 border-b py-3 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)_auto]">
            <b className={cn("text-[13.5px]", week.from === null && "text-bad")}>
              {week.from === null ? t("overdue") : f.range(week.from, week.to)}
            </b>
            {week.invoices.length === 0 ? (
              <span className="text-[13px] text-muted-foreground">{t("nothing")}</span>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
                {week.invoices.map((invoice) => (
                  <li key={invoice.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <Link href={invoiceHref(invoice.id)} className="num font-semibold text-brand-ink hover:text-primary">
                      {invoice.number}
                    </Link>
                    <span>{invoice.supplierName}</span>
                    <span className="text-muted-foreground">
                      · <span className="num">{invoice.projectRef}</span> · {invoice.dueOn && f.shortDay(invoice.dueOn)}
                    </span>
                    <span className="num ml-auto text-muted-foreground sm:hidden">{f.amount(invoice.outstandingCents)}</span>
                  </li>
                ))}
              </ul>
            )}
            <span className={cn("num font-semibold sm:text-right", week.from === null && week.totalCents > 0 && "text-bad", week.totalCents === 0 && "text-muted-foreground")}>
              {f.amount(week.totalCents)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Payments, newest first, with their proof; a manager may take one back. */
export function PaymentTable({
  payments,
  title,
  empty,
  footer,
  invoiceColumns = true,
  onRemove,
  pending,
}: {
  payments: PurchasePayment[];
  title: React.ReactNode;
  empty: string;
  footer?: React.ReactNode;
  /** The supplier and invoice of each: the company's list, not one invoice's. */
  invoiceColumns?: boolean;
  /** Omitted for viewers. */
  onRemove?: (payment: PurchasePayment) => void;
  pending: boolean;
}) {
  const t = useTranslations("purchasing.payments.cols");
  const tm = useTranslations("purchasing.method");
  const tr = useTranslations("purchasing.invoice.payments");
  const f = usePurchaseFormat();
  const titleId = useId();
  const columns = (invoiceColumns ? 7 : 5) + (onRemove ? 1 : 0);
  return (
    <section className={cn(cardVariants({ size: "flush" }), "pt-4 pb-1.5")} aria-labelledby={titleId}>
      <div className="px-[18px] pb-2.5">
        <h2 id={titleId} className="text-[22px]">
          {title}
        </h2>
      </div>
      {payments.length === 0 ? (
        <p className="px-[18px] pb-3 text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <Table className={cn("text-[13px]", invoiceColumns ? "min-w-[900px]" : "min-w-[640px]")}>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-[18px]">{t("paidOn")}</TableHead>
              {invoiceColumns && <TableHead>{t("supplier")}</TableHead>}
              {invoiceColumns && <TableHead>{t("invoice")}</TableHead>}
              <TableHead className="text-right">{t("amount")}</TableHead>
              <TableHead>{t("method")}</TableHead>
              <TableHead>{t("proof")}</TableHead>
              <TableHead className={onRemove ? undefined : "pr-[18px]"}>{t("by")}</TableHead>
              {onRemove && <TableHead className="pr-[18px]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell className="num pl-[18px]">{f.shortDay(payment.paidOn)}</TableCell>
                {invoiceColumns && <TableCell className="whitespace-normal">{payment.supplierName}</TableCell>}
                {invoiceColumns && (
                  <TableCell>
                    <Link href={invoiceHref(payment.invoiceId)} className="num font-semibold text-brand-ink hover:text-primary">
                      {payment.invoiceNumber}
                    </Link>{" "}
                    <span className="num text-[12px] text-muted-foreground">{payment.projectRef}</span>
                  </TableCell>
                )}
                <TableCell className="num text-right">{f.amount(payment.amountCents)}</TableCell>
                <TableCell>
                  {tm(payment.method)}
                  {payment.reference && <span className="num block text-[12px] text-muted-foreground">{payment.reference}</span>}
                </TableCell>
                <TableCell>
                  {payment.file ? (
                    <a href={paymentFileUrl(payment.id)} download className="inline-flex items-center gap-1.5 font-medium text-brand-ink hover:text-primary">
                      <FileText aria-hidden className="size-4" />
                      {payment.file.name}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className={onRemove ? undefined : "pr-[18px]"}>{payment.by ?? "—"}</TableCell>
                {onRemove && (
                  <TableCell className="pr-[18px] text-right">
                    <Button
                      type="button"
                      variant="ghost-destructive"
                      size="sm"
                      disabled={pending}
                      aria-label={tr("removeOf", { date: f.shortDay(payment.paidOn) })}
                      onClick={() => onRemove(payment)}
                    >
                      {tr("remove")}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
          {footer && (
            <TableFooter>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns} className="pl-[18px]">
                  {footer}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      )}
    </section>
  );
}
