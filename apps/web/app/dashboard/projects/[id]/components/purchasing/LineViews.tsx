"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import {
  type ProjectPurchaseLines,
  type PurchaseInvoiceListItem,
} from "@repo/core/contract";
import { useVatLabel } from "../../../../components/vat-basis";
import Kpi from "../obra/Kpi";
import { usePurchaseFormat } from "./format";
import { DeviationKpi } from "./ProjectKpis";
import {
  INVOICES_HREF,
  invoiceHref,
  ordersViewHref,
  requestsViewHref,
  purchasesHref,
} from "./links";

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
