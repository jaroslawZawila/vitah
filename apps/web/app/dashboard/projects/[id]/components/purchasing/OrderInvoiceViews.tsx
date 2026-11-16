"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { MAX_MILESTONES, type PurchaseOrderDetail } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import FormError from "../../../../components/FormError";
import { useVatLabel } from "../../../../components/vat-basis";
import { usePurchaseFormat } from "./format";
import { InvoicingFoot } from "./LineOrders";
import { invoiceHref } from "./links";
import { InvoiceStatePill, ProgressPill } from "./pills";
import { touchLink } from "../../../../components/touch";
import { phoneFigures } from "../../../../components/phone-table";

// Presentational: an order's payment schedule (milestones) and its invoices,
// on its page. The container (OrderScreen) runs the actions.

/** A milestone as typed: the amount in euros as written. */
type Row = { id?: string; concept: string; amount: string; locked: boolean };

/**
 * Below 768px the milestones and invoices tables reflow into one block per row
 * (the same elements): what it is on top, then its figures two by two, each
 * under its column's name.
 */
const phone = phoneFigures;

/**
 * The order's payment schedule: each milestone's share, where it stands and
 * its invoices; editable by admins and managers (an invoiced milestone keeps
 * its amount), adding up to the order's amount.
 */
export function MilestonesCard({
  order,
  canEdit,
  pending,
  error,
  onSave,
}: {
  order: PurchaseOrderDetail;
  canEdit: boolean;
  pending: boolean;
  error?: string;
  /** `onSaved` runs once they are saved, closing the editor. */
  onSave: (milestones: { id?: string; concept: string; amountCents: number }[], onSaved: () => void) => void;
}) {
  const t = useTranslations("purchasing.milestones");
  const f = usePurchaseFormat();
  const [rows, setRows] = useState<Row[] | null>(null);
  const { milestones, amountCents } = order;
  const scheduled = milestones.reduce((sum, m) => sum + m.amountCents, 0);
  const share = (cents: number) => (amountCents ? f.decimal((cents * 100) / amountCents) : "—");

  function edit() {
    setRows(
      milestones.length > 0
        ? milestones.map((m) => ({ id: m.id, concept: m.concept, amount: f.decimal(m.amountCents / 100), locked: m.invoices.length > 0 }))
        : [{ concept: "", amount: f.decimal(amountCents / 100), locked: false }],
    );
  }
  const set = (index: number, patch: Partial<Row>) =>
    setRows((current) => current && current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const parsed = rows?.map((row) => f.hundredths(row.amount)) ?? [];
  const sum = parsed.reduce((total, cents) => total + (Number.isFinite(cents) ? cents : 0), 0);
  const valid = rows !== null && rows.every((row, i) => row.concept.trim() && (parsed[i] ?? 0) > 0) && (rows.length === 0 || sum === amountCents);

  return (
    <section className={cn(cardVariants({ size: "flush" }), "pt-4")} aria-labelledby="milestones-title">
      <div className="flex flex-wrap items-start justify-between gap-2.5 px-[18px] pb-2.5">
        <div className="min-w-0 flex-[1_1_320px]">
          <h2 id="milestones-title" className="text-[22px]">
            {t("title")}
          </h2>
          <p className="mt-1 max-w-[640px] text-meta text-muted-foreground">{t("hint")}</p>
        </div>
        {canEdit && rows === null && (
          <Button type="button" variant="outline" onClick={edit}>
            {milestones.length > 0 ? t("edit") : t("define")}
          </Button>
        )}
      </div>

      {rows === null ? (
        milestones.length === 0 ? (
          <p className="px-[18px] pb-4 text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <>
            {scheduled !== amountCents && (
              <p role="status" className="mx-[18px] mb-2.5 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                {t("gap", { sum: f.amount(scheduled), total: f.amount(amountCents) })}
              </p>
            )}
            <Table className={cn(phone.block, "md:min-w-[760px]")}>
              <TableHeader className="max-md:hidden">
                <TableRow>
                  <TableHead className="pl-[18px]">{t("concept")}</TableHead>
                  <TableHead className="text-right">{t("pct")}</TableHead>
                  <TableHead className="text-right">{t("amount")}</TableHead>
                  <TableHead>{t("state")}</TableHead>
                  <TableHead>{t("invoice")}</TableHead>
                  <TableHead className="pr-[18px] text-right">{t("payment")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={phone.block}>
                {milestones.map((m, index) => (
                  <TableRow key={m.id} className={phone.row}>
                    <TableCell className="pl-[18px] whitespace-normal max-md:col-span-2 max-md:p-0">
                      <b>{index + 1}.</b> {m.concept}
                    </TableCell>
                    <TableCell className={cn("num text-right", phone.cell)}>
                      <span className={phone.label}>{t("pct")}</span>
                      {share(m.amountCents)}
                    </TableCell>
                    <TableCell className={cn("num text-right", phone.cell)}>
                      <span className={phone.label}>{t("amount")}</span>
                      {f.amount(m.amountCents)}
                    </TableCell>
                    <TableCell className={phone.cell}>
                      <span className={phone.label}>{t("state")}</span>
                      <ProgressPill progress={m.progress} />
                    </TableCell>
                    <TableCell className={cn("whitespace-normal", phone.cell)}>
                      <span className={phone.label}>{t("invoice")}</span>
                      {m.invoices.length === 0 ? (
                        <span className="text-muted-foreground">{t("noInvoice")}</span>
                      ) : (
                        <span className="flex flex-wrap gap-x-2.5 gap-y-1">
                          {m.invoices.map((invoice) => (
                            <Link key={invoice.id} href={invoiceHref(invoice.id)} className={cn("num font-semibold text-brand-ink hover:text-primary", touchLink)}>
                              {invoice.number}
                            </Link>
                          ))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className={cn("num pr-[18px] text-right", m.progress === "paid" ? "text-good" : m.outstandingCents > 0 && "text-warn", phone.cell, "max-md:col-span-2")}>
                      <span className={phone.label}>{t("payment")}</span>
                      {m.invoicedCents === 0 ? "—" : `${f.amount(m.paidCents)} / ${f.amount(m.invoicedCents - m.retainedCents)}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter className={phone.block}>
                <TableRow className={cn("hover:bg-transparent", phone.row)}>
                  <TableCell className="pl-[18px] max-md:col-span-2 max-md:p-0">{t("total")}</TableCell>
                  <TableCell className={cn("num text-right", phone.cell)}>{share(scheduled)}</TableCell>
                  <TableCell className={cn("num text-right", phone.cell)}>{f.amount(scheduled)}</TableCell>
                  <TableCell colSpan={3} className={cn("pr-[18px] max-md:col-span-2 max-md:p-0", scheduled === amountCents ? "text-good" : "text-warn")}>
                    {scheduled === amountCents ? t("matches") : ""}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </>
        )
      ) : (
        <form
          aria-label={t("edit")}
          className="flex flex-col gap-2.5 pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            onSave(
              rows.map((row, i) => ({ ...(row.id ? { id: row.id } : {}), concept: row.concept.trim(), amountCents: parsed[i]! })),
              () => setRows(null),
            );
          }}
        >
          <ul className="m-0 flex list-none flex-col gap-2 px-[18px] py-0">
            {rows.map((row, index) => (
              <li key={row.id ?? `new-${index}`} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_80px_150px_auto]">
                <Input
                  aria-label={t("conceptOf", { n: index + 1 })}
                  value={row.concept}
                  maxLength={200}
                  disabled={row.locked}
                  onChange={(e) => set(index, { concept: e.target.value })}
                />
                <span className="num text-right text-sm text-muted-foreground">
                  {Number.isFinite(parsed[index]) ? share(parsed[index]!) : "—"} %
                </span>
                <Input
                  aria-label={t("amountOf", { n: index + 1 })}
                  className="num text-right"
                  inputMode="decimal"
                  value={row.amount}
                  disabled={row.locked}
                  onChange={(e) => set(index, { amount: e.target.value })}
                />
                {row.locked ? (
                  <span className="text-meta text-muted-foreground">{t("locked")}</span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost-destructive"
                    size="sm"
                    aria-label={t("removeOf", { n: index + 1 })}
                    onClick={() => setRows((current) => current && current.filter((_, i) => i !== index))}
                  >
                    {t("remove")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-[18px]">
            {rows.length < MAX_MILESTONES && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRows((current) => current && [...current, { concept: "", amount: f.decimal(Math.max(0, amountCents - sum) / 100), locked: false }])}
              >
                {t("add")}
              </Button>
            )}
            <span className={cn("num ml-auto text-sm font-semibold", rows.length === 0 || sum === amountCents ? "text-good" : "text-warn")}>
              {f.amount(sum)} / {f.amount(amountCents)}
            </span>
          </div>
          <p className="m-0 px-[18px] text-meta text-muted-foreground">{t("editHint", { total: f.amount(amountCents) })}</p>
          <div className="px-[18px] empty:hidden">
            <FormError namespace="purchasing.errors" error={error} />
          </div>
          <div className="flex flex-wrap justify-end gap-2 px-[18px]">
            <Button type="button" variant="outline" onClick={() => setRows(null)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending || !valid}>
              {pending ? t("saving") : t("save")}
            </Button>
          </div>
        </form>
      )}
      {(milestones.length > 0 || order.invoices.length > 0) && rows === null && <InvoicingFoot invoicing={order.invoicing} className="gap-x-6 gap-y-1.5 border-t px-[18px] py-3 text-sm" />}
    </section>
  );
}

/** The order's invoices and credit notes, newest first, each with where it stands. */
export function OrderInvoices({ order, registerHref }: { order: PurchaseOrderDetail; registerHref?: string }) {
  const t = useTranslations("purchasing.orderInvoices");
  const ti = useTranslations("purchasing.invoices");
  const f = usePurchaseFormat();
  const vat = useVatLabel();
  return (
    <section className={cn(cardVariants({ size: "flush" }), "pt-4 pb-1.5")} aria-labelledby="order-invoices-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5 px-[18px] pb-2.5">
        <h2 id="order-invoices-title" className="text-[22px]">
          {t("title")} <span className="num text-[16px] text-muted-foreground">{order.invoices.length}</span>
        </h2>
        {registerHref && (
          <Link href={registerHref} className={cn("text-sm font-semibold text-brand-ink hover:text-primary", touchLink)}>
            {t("register")}
          </Link>
        )}
      </div>
      {order.invoices.length === 0 ? (
        <p className="px-[18px] pb-3 text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <>
          <Table className={cn(phone.block, "md:min-w-[860px]")}>
            <TableHeader className="max-md:hidden">
              <TableRow>
                <TableHead className="pl-[18px]">{t("number")}</TableHead>
                <TableHead>{t("milestone")}</TableHead>
                <TableHead>{t("issuedOn")}</TableHead>
                <TableHead>{t("dueOn")}</TableHead>
                <TableHead className="text-right">{t("base")}</TableHead>
                <TableHead className="text-right">{vat(t("payable"), "incl")}</TableHead>
                <TableHead className="text-right">{vat(t("paid"), "incl")}</TableHead>
                <TableHead className="pr-[18px]">{t("state")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={phone.block}>
              {order.invoices.map((invoice) => (
                <TableRow key={invoice.id} className={phone.row}>
                  <TableCell className="pl-[18px] max-md:-order-2 max-md:p-0">
                    <Link href={invoiceHref(invoice.id)} className={cn("num font-semibold text-brand-ink hover:text-primary", touchLink)}>
                      {invoice.number}
                    </Link>
                    {invoice.rectifiesNumber && (
                      <span className="block text-meta text-muted-foreground">{ti("rectifies", { number: invoice.rectifiesNumber })}</span>
                    )}
                  </TableCell>
                  <TableCell className={cn("whitespace-normal", phone.cell, "max-md:col-span-2", !invoice.milestoneConcept && "max-md:hidden")}>
                    <span className={phone.label}>{t("milestone")}</span>
                    {invoice.milestoneConcept ?? "—"}
                  </TableCell>
                  <TableCell className={cn("num", phone.cell)}>
                    <span className={phone.label}>{t("issuedOn")}</span>
                    {f.date(invoice.issuedOn)}
                  </TableCell>
                  <TableCell className={cn("num", invoice.state === "overdue" && "font-semibold text-bad", phone.cell)}>
                    <span className={phone.label}>{t("dueOn")}</span>
                    {f.date(invoice.dueOn)}
                  </TableCell>
                  <TableCell className={cn("num text-right", phone.cell)}>
                    <span className={phone.label}>{t("base")}</span>
                    {f.amount(invoice.baseCents)}
                  </TableCell>
                  <TableCell className={cn("num text-right", phone.cell)}>
                    <span className={phone.label}>{vat(t("payable"), "incl")}</span>
                    {f.amount(invoice.payableCents)}
                  </TableCell>
                  <TableCell className={cn("num text-right", phone.cell)}>
                    <span className={phone.label}>{vat(t("paid"), "incl")}</span>
                    {invoice.kind === "invoice" ? f.amount(invoice.paidCents) : "—"}
                  </TableCell>
                  <TableCell className="pr-[18px] max-md:-order-1 max-md:justify-self-end max-md:p-0">
                    <InvoiceStatePill state={invoice.state} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mx-[18px] mt-2.5 mb-1 text-meta text-muted-foreground">{t("note")}</p>
        </>
      )}
    </section>
  );
}
