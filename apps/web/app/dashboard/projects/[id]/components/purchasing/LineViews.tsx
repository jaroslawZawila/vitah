"use client";

import Link from "next/link";
import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Clock, FileText } from "lucide-react";
import {
  orderLabel,
  PURCHASE_PROGRESS,
  type OrderInvoicing,
  type ProjectPurchaseLines,
  type PurchaseInvoiceListItem,
  type PurchaseLineItem,
  type PurchaseLineOrder,
  type PurchaseProgress,
} from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useVatLabel } from "../../../../components/vat-basis";
import Kpi from "../obra/Kpi";
import { deviationTone } from "../construction/format";
import FoldRow from "../construction/FoldRow";
import { Dot } from "../construction/pills";
import { usePurchaseFormat } from "./format";
import type { LineRollup } from "./line-rollup";
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
  PROGRESS_TONE,
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
      className="inline-flex min-h-[34px] flex-none items-center rounded-[7px] px-3.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground pointer-coarse:min-h-11 aria-[current=page]:bg-card aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:shadow-card"
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
  const vat = useVatLabel();
  const pct = (part: number, whole: number) =>
    whole ? (part * 100) / whole : 0;
  return (
    <section
      aria-label={t("label")}
      className="grid grid-cols-2 gap-3.5 lg:grid-cols-4"
    >
      <Kpi
        label={vat(t("contracted"), "excl")}
        value={f.money(summary.contractedCents)}
        pct={pct(summary.contractedCents, summary.costCents)}
        barTone="brand"
        hints={[
          t("contractedHint", {
            pct: f.ratio(summary.contractedCents, summary.costCents),
            cost: f.money(summary.costCents),
            left: f.money(summary.toContractCents),
          }),
        ]}
      />
      <DeviationKpi summary={summary} />
      <Kpi
        label={vat(t("invoiced"), "excl")}
        value={f.money(summary.invoicedCents)}
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
        label={vat(t("paid"), "excl")}
        value={f.money(summary.paidCents)}
        pct={pct(summary.paidCents, summary.invoicedCents)}
        hints={[
          t("paidHint", {
            outstanding: f.money(summary.outstandingCents),
            retained: f.money(summary.retainedCents),
          }),
          ...(summary.overdueCents > 0
            ? [
                <span key="overdue" className="text-bad">
                  {t("overdueHint", {
                    amount: f.money(summary.overdueCents),
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
      className="flex flex-wrap items-start gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3.5 text-sm text-warn"
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
                date: f.date(invoice.dueOn),
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
      <p className="m-0 text-sm text-muted-foreground">
        {t("noOrders")} {orderBy && t("orderBy", { date: f.date(orderBy) })}{" "}
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

export type LineChapter = ProjectPurchaseLines["chapters"][number] & {
  rollup: LineRollup;
  /** Its lines to contract must be ordered soon (or are late). */
  soon: { orderBy: string; lateDays: number } | null;
};

/** A chapter's money folded (or the obra's): cost, contracted, deviation, invoiced and paid. */
function RollupCells({ rollup }: { rollup: LineRollup }) {
  const f = usePurchaseFormat();
  const amount = (cents: number) => (cents ? f.amount(cents) : "—");
  return (
    <>
      <TableCell className="num text-right font-semibold">
        {f.amount(rollup.costCents)}
      </TableCell>
      <TableCell className="num text-right font-semibold">
        {amount(rollup.contractedCents)}
      </TableCell>
      <TableCell
        className={cn(
          "num text-right font-semibold",
          deviationTone(rollup.deviationCents),
        )}
      >
        {rollup.deviationCents === null
          ? "—"
          : f.signedAmount(rollup.deviationCents)}
      </TableCell>
      <TableCell className="num text-right font-semibold">
        {amount(rollup.invoicedCents)}
      </TableCell>
      <TableCell className="num text-right font-semibold">
        {amount(rollup.paidCents)}
      </TableCell>
    </>
  );
}

/** A chapter folded into one row: its lines' totals, how many are in each state, and what needs a look. */
function ChapterRow({
  chapter,
  open,
  controls,
  onToggle,
}: {
  chapter: LineChapter;
  open: boolean;
  /** The id of the rows it folds. */
  controls: string;
  onToggle: () => void;
}) {
  const t = useTranslations("purchasing.lines");
  const f = usePurchaseFormat();
  const { rollup, soon } = chapter;
  return (
    <FoldRow
      code={chapter.code}
      open={open}
      controls={controls}
      onToggle={onToggle}
      label={
        <>
          <b className="min-w-0">{chapter.name}</b>
          <span className="text-meta text-muted-foreground">
            {t("lineCount", { count: rollup.lines })}
          </span>
          {rollup.overdue > 0 && (
            <Badge variant="destructive" className="px-2 py-px">
              <Dot />
              {t("overdueLines", { count: rollup.overdue })}
            </Badge>
          )}
          {rollup.lateOrders > 0 && (
            <Badge variant="warn" className="px-2 py-px">
              <Dot />
              {t("lateOrders", { count: rollup.lateOrders })}
            </Badge>
          )}
          {soon && (
            <Badge variant="warn" className="px-2 py-px">
              <Dot />
              {soon.lateDays > 0
                ? t("orderLate", { days: soon.lateDays })
                : t("orderSoon", { date: f.date(soon.orderBy) })}
            </Badge>
          )}
        </>
      }
    >
      <RollupCells rollup={rollup} />
      <TableCell className="pr-[18px] whitespace-normal">
        <span className="flex flex-wrap items-center gap-1">
          {PURCHASE_PROGRESS.filter((key) => rollup.counts[key] > 0).map(
            (key) => (
              <Badge
                key={key}
                variant={PROGRESS_TONE[key]}
                className="px-2 py-px"
              >
                <Dot />
                {t(`stateCount.${key}`, { count: rollup.counts[key] })}
              </Badge>
            ),
          )}
        </span>
      </TableCell>
    </FoldRow>
  );
}

/**
 * The budget's lines chapter by chapter. Each chapter is one row with its
 * lines' cost, what is contracted, its deviation (over its closed lines),
 * invoiced and paid, how many lines are in each state and what needs a look
 * (invoices past due, late deliveries, lines to order soon); it folds open
 * on its lines, and a line on its orders, milestones, invoices and payments.
 */
export function LineTable({
  projectId,
  chapters,
  total,
  open,
  onToggleChapter,
  expanded,
  onToggle,
  newOrderHref,
}: {
  projectId: string;
  /** Already filtered, each with its lines' totals. */
  chapters: LineChapter[];
  /** The obra's totals, shown only while nothing is filtered out. */
  total?: LineRollup;
  open: (chapterCode: string) => boolean;
  onToggleChapter: (chapterCode: string) => void;
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
      <p className="px-[18px] py-6 text-center text-sm text-muted-foreground">
        {t("noMatch")}
      </p>
    );
  return (
    <Table className="min-w-[940px]">
      <TableHeader>
        <TableRow>
          <TableHead className="pl-[18px]">{t("line")}</TableHead>
          <TableHead className="text-right">{t("cost")}</TableHead>
          <TableHead className="text-right">{t("contracted")}</TableHead>
          <TableHead className="text-right">{t("deviation")}</TableHead>
          <TableHead className="text-right">{t("invoiced")}</TableHead>
          <TableHead className="text-right">{t("paid")}</TableHead>
          <TableHead className="pr-[18px]">{t("state")}</TableHead>
        </TableRow>
      </TableHeader>
      {chapters.map((chapter) => {
        const body = `lines-chapter-${chapter.code}`;
        const folded = !open(chapter.code);
        return (
          <Fragment key={chapter.code}>
            <tbody>
              <ChapterRow
                chapter={chapter}
                open={!folded}
                controls={body}
                onToggle={() => onToggleChapter(chapter.code)}
              />
            </tbody>
            <tbody id={body}>
              {!folded &&
                chapter.lines.map((line) => {
                  const lineOpen = expanded(line.lineageId);
                  return (
                    <Fragment key={line.lineageId}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => onToggle(line.lineageId)}
                      >
                        <TableCell className="p-0 whitespace-normal">
                          <button
                            type="button"
                            aria-expanded={lineOpen}
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
                                lineOpen && "rotate-90",
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
                            f.signedAmount(line.deviationCents)
                          ) : line.uncontractedCents > 0 ? (
                            <span className="font-sans text-meta">
                              {t("toContract", {
                                amount: f.amount(line.uncontractedCents),
                              })}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="num text-right">
                          {line.invoicedCents
                            ? f.amount(line.invoicedCents)
                            : "—"}
                        </TableCell>
                        <TableCell className="num text-right">
                          {line.paidCents ? f.amount(line.paidCents) : "—"}
                        </TableCell>
                        <TableCell className="pr-[18px]">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <ProgressPill progress={line.progress} />
                            {line.overdue && (
                              <InvoiceStatePill state="overdue" />
                            )}
                          </span>
                        </TableCell>
                      </TableRow>
                      {lineOpen && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell
                            colSpan={7}
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
            </tbody>
          </Fragment>
        );
      })}
      {total && (
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell className="pl-[18px]">
              {t("total", { count: total.lines })}
            </TableCell>
            <RollupCells rollup={total} />
            <TableCell className="pr-[18px] text-meta font-normal text-muted-foreground">
              {t("closedNote", { count: total.closedLines })}
            </TableCell>
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
}
