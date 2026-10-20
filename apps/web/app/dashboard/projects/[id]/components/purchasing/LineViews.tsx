"use client";

import Link from "next/link";
import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Clock, FileText } from "lucide-react";
import {
  orderLabel,
  type OrderInvoicing,
  type ProjectPurchaseLines,
  type PurchaseInvoiceListItem,
  type PurchaseLineItem,
  type PurchaseLineOrder,
  type PurchaseProgress,
} from "@repo/core/contract";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import Kpi from "../obra/Kpi";
import { deviationTone } from "../construction/format";
import { usePurchaseFormat } from "./format";
import { DeviationKpi } from "./ProjectKpis";
import {
  INVOICES_HREF,
  invoiceHref,
  orderHref,
  ordersViewHref,
  requestsViewHref,
  purchasesHref,
} from "./links";
import {
  InvoiceStatePill,
  LatePill,
  ProgressPill,
  PurchaseKindPill,
  PurchaseStatusPill,
} from "./pills";

// Presentational: the project's Compras by budget line (the four states), its
// figures and its invoices due. The container (PurchaseLinesScreen) filters.

/** Partidas | Pedidos: the tab's two views, as links. */
export function ViewSwitch({
  projectId,
  view,
}: {
  projectId: string;
  view: "lines" | "requests" | "orders";
}) {
  const t = useTranslations("purchasing.views");
  const tab = (key: "lines" | "requests" | "orders", href: string) => (
    <Link
      href={href}
      aria-current={view === key ? "page" : undefined}
      className="inline-flex min-h-[34px] flex-none items-center rounded-[7px] px-3.5 text-[13px] whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground pointer-coarse:min-h-11 aria-[current=page]:bg-card aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:shadow-card"
    >
      {t(key)}
    </Link>
  );
  return (
    <nav
      aria-label={t("label")}
      className="inline-flex max-w-full gap-0.5 rounded-[10px] border bg-raise p-[3px]"
    >
      {tab("lines", purchasesHref(projectId))}
      {tab("requests", requestsViewHref(projectId))}
      {tab("orders", ordersViewHref(projectId))}
    </nav>
  );
}

/** The obra's purchasing at a glance: contracted against cost, the deviation, invoiced and paid. */
export function LineKpis({
  summary,
}: {
  summary: ProjectPurchaseLines["summary"];
}) {
  const t = useTranslations("purchasing.lines.kpis");
  const f = usePurchaseFormat();
  const pct = (part: number, whole: number) =>
    whole ? (part * 100) / whole : 0;
  return (
    <section
      aria-label={t("label")}
      className="grid grid-cols-2 gap-3.5 lg:grid-cols-4"
    >
      <Kpi
        label={t("contracted")}
        value={f.moneyRound(summary.contractedCents)}
        pct={pct(summary.contractedCents, summary.costCents)}
        barTone="brand"
        hints={[
          t("contractedHint", {
            pct: f.ratio(summary.contractedCents, summary.costCents),
            cost: f.moneyRound(summary.costCents),
            left: f.moneyRound(summary.toContractCents),
          }),
        ]}
      />
      <DeviationKpi summary={summary} />
      <Kpi
        label={t("invoiced")}
        value={f.moneyRound(summary.invoicedCents)}
        pct={pct(summary.invoicedCents, summary.contractedCents)}
        barTone="brand"
        hints={[
          t("invoicedHint", {
            pct: f.ratio(summary.invoicedCents, summary.contractedCents),
            count: summary.invoices,
          }),
          ...(summary.creditNotes > 0
            ? [t("creditNotes", { count: summary.creditNotes })]
            : []),
        ]}
      />
      <Kpi
        label={t("paid")}
        value={f.moneyRound(summary.paidCents)}
        pct={pct(summary.paidCents, summary.invoicedCents)}
        hints={[
          t("paidHint", {
            outstanding: f.moneyRound(summary.outstandingCents),
            retained: f.moneyRound(summary.retainedCents),
          }),
          ...(summary.overdueCents > 0
            ? [
                <span key="overdue" className="text-bad">
                  {t("overdueHint", {
                    amount: f.moneyRound(summary.overdueCents),
                  })}
                </span>,
              ]
            : []),
        ]}
      />
    </section>
  );
}

/** The obra's invoices past due or due within a week: Administration pays them. */
export function DueBanner({
  invoices,
}: {
  invoices: PurchaseInvoiceListItem[];
}) {
  const t = useTranslations("purchasing.lines.due");
  const f = usePurchaseFormat();
  if (invoices.length === 0) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3.5 text-[13.5px] text-warn"
    >
      <Clock aria-hidden className="mt-0.5 size-5 flex-none" />
      <div className="min-w-0 flex-[1_1_320px]">
        <b>{t("title", { count: invoices.length })}</b>{" "}
        {invoices.map((invoice, index) => (
          <span key={invoice.id}>
            {index > 0 && "; "}
            <Link href={invoiceHref(invoice.id)} className="underline">
              {t("item", {
                number: invoice.number,
                supplier: invoice.supplierName,
                amount: f.money(Math.max(0, invoice.outstandingCents)),
              })}
            </Link>{" "}
            {invoice.dueOn &&
              t(invoice.state === "overdue" ? "overdue" : "dueOn", {
                date: f.shortDay(invoice.dueOn),
              })}
          </span>
        ))}
        . {t("byAdmin")}
      </div>
      <Link
        href={INVOICES_HREF}
        className="font-semibold whitespace-nowrap underline"
      >
        {t("link")}
      </Link>
    </div>
  );
}

/** A milestone's or invoice's row: concept, amount, state, invoices, payment (stacked on phones). */
const row =
  "grid items-center gap-x-3.5 gap-y-1 border-b px-3.5 py-2 text-[13px] last:border-b-0 max-md:grid-cols-2 md:grid-cols-[minmax(0,1fr)_110px_110px_150px_minmax(0,1fr)]";

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
      const date = invoice.dueOn ? f.shortDay(invoice.dueOn) : "—";
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
      className="num inline-flex items-center gap-1 font-semibold text-brand-ink hover:text-primary"
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
        "m-0 flex flex-wrap gap-x-5 gap-y-1 bg-raise px-3.5 py-2 text-[12.5px]",
        className,
      )}
    >
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3.5 py-2.5 text-[13px]">
        <Link
          href={orderHref(projectId, order.id)}
          className="num font-semibold text-brand-ink hover:text-primary"
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
                <span className={cn("min-w-0 text-[12.5px]", text.tone)}>
                  {text.text}
                </span>
              </li>
            );
          })
        ) : order.invoices.length === 0 ? (
          <li className="px-3.5 py-2 text-[13px] text-muted-foreground">
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
                  <span className="text-[12px] text-muted-foreground">
                    {f.shortDay(invoice.issuedOn)}
                  </span>
                </span>
                <span className="num md:text-right">
                  {f.amount(invoice.baseCents)}
                </span>
                <span>
                  <InvoiceStatePill state={invoice.state} />
                </span>
                <span className="max-md:hidden" />
                <span className={cn("min-w-0 text-[12.5px]", text.tone)}>
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
function LineDetail({
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
      <p className="m-0 text-[13px] text-muted-foreground">
        {t("noOrders")} {orderBy && t("orderBy", { date: f.shortDay(orderBy) })}{" "}
        {newOrderHref && (
          <Link
            href={newOrderHref}
            className="font-semibold text-brand-ink hover:text-primary"
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

/**
 * The budget's lines chapter by chapter, each with its cost, what is
 * contracted, its deviation (only once closed; before, what is left to
 * contract) and its state; a line folds open on its orders, milestones,
 * invoices and payments.
 */
export function LineTable({
  projectId,
  chapters,
  summary,
  expanded,
  onToggle,
  newOrderHref,
}: {
  projectId: string;
  /** Already filtered. */
  chapters: ProjectPurchaseLines["chapters"];
  /** The obra's totals, shown only while nothing is filtered out. */
  summary?: ProjectPurchaseLines["summary"];
  expanded: (lineageId: string) => boolean;
  onToggle: (lineageId: string) => void;
  /** "Crear pedido" on a line nobody ordered; omitted for viewers. */
  newOrderHref?: (chapterCode: string) => string;
}) {
  const t = useTranslations("purchasing.lines");
  const f = usePurchaseFormat();
  const count = chapters.reduce((sum, c) => sum + c.lines.length, 0);
  if (count === 0)
    return (
      <p className="px-[18px] py-6 text-center text-[13.5px] text-muted-foreground">
        {t("noMatch")}
      </p>
    );
  return (
    <Table className="min-w-[860px] text-[13px]">
      <TableHeader>
        <TableRow>
          <TableHead className="pl-[18px]">{t("line")}</TableHead>
          <TableHead className="text-right">{t("cost")}</TableHead>
          <TableHead className="text-right">{t("contracted")}</TableHead>
          <TableHead className="text-right">{t("deviation")}</TableHead>
          <TableHead className="pr-[18px]">{t("state")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {chapters.map((chapter) => {
          const contracted = chapter.lines.filter(
            (l) => l.contracting !== "none",
          ).length;
          return (
            <Fragment key={chapter.code}>
              <TableRow className="bg-raise/60 hover:bg-raise/60">
                <TableCell className="pl-[18px] font-semibold whitespace-normal">
                  <span className="num">{chapter.code}</span> {chapter.name}
                </TableCell>
                <TableCell className="num text-right font-semibold">
                  {f.amount(chapter.costCents)}
                </TableCell>
                <TableCell className="num text-right font-semibold">
                  {chapter.contractedCents
                    ? f.amount(chapter.contractedCents)
                    : "—"}
                </TableCell>
                <TableCell
                  className={cn(
                    "num text-right font-semibold",
                    deviationTone(chapter.deviationCents),
                  )}
                >
                  {chapter.deviationCents === null
                    ? "—"
                    : f.signedDecimal(chapter.deviationCents)}
                </TableCell>
                <TableCell className="pr-[18px] text-[12.5px] text-muted-foreground">
                  {t("chapterSummary", {
                    contracted,
                    total: chapter.lines.length,
                  })}
                </TableCell>
              </TableRow>
              {chapter.lines.map((line) => {
                const open = expanded(line.lineageId);
                return (
                  <Fragment key={line.lineageId}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => onToggle(line.lineageId)}
                    >
                      <TableCell className="p-0 whitespace-normal">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={(event) => {
                            event.stopPropagation();
                            onToggle(line.lineageId);
                          }}
                          className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 py-2 pl-[18px] text-left"
                        >
                          <ChevronRight
                            aria-hidden
                            className={cn(
                              "size-4 flex-none text-muted-foreground transition-transform",
                              open && "rotate-90",
                            )}
                          />
                          <span className="num flex-none text-muted-foreground">
                            {line.code}
                          </span>
                          <span className="min-w-0">{line.description}</span>
                        </button>
                      </TableCell>
                      <TableCell className="num text-right">
                        {f.amount(line.costCents)}
                      </TableCell>
                      <TableCell className="num text-right">
                        {line.contracting === "none"
                          ? "—"
                          : f.amount(line.contractedCents)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "num text-right",
                          line.deviationCents === null
                            ? "text-muted-foreground"
                            : deviationTone(line.deviationCents),
                        )}
                      >
                        {line.deviationCents !== null ? (
                          f.signedDecimal(line.deviationCents)
                        ) : line.uncontractedCents > 0 ? (
                          <span className="font-sans text-[12.5px]">
                            {t("toContract", {
                              amount: f.amount(line.uncontractedCents),
                            })}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="pr-[18px]">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <ProgressPill progress={line.progress} />
                          {line.overdue && <InvoiceStatePill state="overdue" />}
                        </span>
                      </TableCell>
                    </TableRow>
                    {open && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={5}
                          className="bg-raise/40 py-3 pr-[18px] pl-[44px] whitespace-normal"
                        >
                          <LineDetail
                            projectId={projectId}
                            line={line}
                            orderBy={chapter.orderBy}
                            newOrderHref={newOrderHref?.(chapter.code)}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </Fragment>
          );
        })}
      </TableBody>
      {summary && (
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell className="pl-[18px]">{t("total", { count })}</TableCell>
            <TableCell className="num text-right">
              {f.amount(summary.costCents)}
            </TableCell>
            <TableCell className="num text-right">
              {f.amount(summary.contractedCents)}
            </TableCell>
            <TableCell
              className={cn(
                "num text-right",
                deviationTone(summary.deviationCents),
              )}
            >
              {summary.deviationCents === null
                ? "—"
                : f.signedDecimal(summary.deviationCents)}
            </TableCell>
            <TableCell className="pr-[18px] text-[12.5px] font-normal text-muted-foreground">
              {t("closedNote", { count: summary.closedLines })}
            </TableCell>
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
}
