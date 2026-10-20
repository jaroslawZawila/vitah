"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { CircleCheck, Clock, FileText } from "lucide-react";
import {
  PURCHASE_PAYMENT_METHODS,
  orderLabel,
  type PurchaseInvoiceAmounts,
  type PurchaseInvoiceDetail,
  type PurchasePaymentMethod,
  type PurchaseVatKind,
} from "@repo/core/contract";
import { todayInSpain } from "@repo/core/obra-calc";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FieldDescription, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import FormError from "../../components/FormError";
import { companyHref } from "../../subcontratas/components/display";
import FileSlot from "../../subcontratas/empresas/nueva/steps/FileSlot";
import { daysBetween } from "../../projects/[id]/components/construction/format";
import { StageEyebrow } from "../../projects/[id]/components/construction/ObraFrame";
import ProgressBar from "../../projects/[id]/components/obra/ProgressBar";
import { usePurchaseFormat } from "../../projects/[id]/components/purchasing/format";
import { invoiceFileUrl, invoiceHref, orderHref } from "../../projects/[id]/components/purchasing/links";
import { InvoiceStatePill } from "../../projects/[id]/components/purchasing/pills";

// Presentational: a supplier invoice's page (heading, where it stands, its
// amounts, data, payments, PDF versions and credit notes). The container
// (InvoiceScreen) runs the actions.

/** A timestamp's day in Spain. */
const day = (iso: string) => todayInSpain(new Date(iso));

/** The supplier's number, its state; the supplier, order and milestone. */
export function InvoiceHeading({ invoice, actions }: { invoice: PurchaseInvoiceDetail; actions?: React.ReactNode }) {
  const t = useTranslations("purchasing.invoice");
  const credit = invoice.kind === "credit_note";
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <StageEyebrow label={t(credit ? "creditEyebrow" : "eyebrow", { ref: invoice.projectRef })} />
          <InvoiceStatePill state={invoice.state} />
        </div>
        <h1 className="num mt-1.5 font-mono text-[30px] [overflow-wrap:anywhere] sm:text-[36px]">{invoice.number}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] text-muted-foreground">
          <Link href={companyHref(invoice.subcontractorId)} className="font-semibold text-brand-ink hover:text-primary">
            {invoice.supplierName}
          </Link>
          <span>·</span>
          <Link href={orderHref(invoice.projectId, invoice.orderId)} className="num hover:text-primary">
            {orderLabel(invoice.orderNumber)}
          </Link>
          <span>{invoice.orderDescription}</span>
          {invoice.milestoneConcept && <span>· {invoice.milestoneConcept}</span>}
        </p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** Where it stands today: due, past due, paid (with the retention still held), or what a credit note takes off. */
export function InvoiceBanner({ invoice }: { invoice: PurchaseInvoiceDetail }) {
  const t = useTranslations("purchasing.invoice.banner");
  const tp = useTranslations("purchasing");
  const f = usePurchaseFormat();
  if (invoice.kind === "credit_note") {
    return (
      <p role="status" className="m-0 rounded-xl border bg-raise px-4 py-3 text-[13.5px]">
        {t("credit", { number: invoice.rectifiesNumber ?? "—", amount: f.money(-invoice.payableCents) })}
      </p>
    );
  }
  if (invoice.state === "paid") {
    return (
      <div role="status" className="flex flex-wrap items-start gap-3 rounded-xl border border-good/30 bg-good-soft px-4 py-3.5 text-[13.5px] text-good">
        <CircleCheck aria-hidden className="mt-0.5 size-5 flex-none" />
        <p className="m-0 min-w-0 flex-1">
          <b>{t("paid")}</b>{" "}
          {invoice.outstandingCents < 0 && t("inFavour", { amount: f.money(-invoice.outstandingCents) })}{" "}
          {invoice.retainedCents > 0 && t("retained", { amount: f.money(invoice.retainedCents) })}
        </p>
      </div>
    );
  }
  const overdue = invoice.state === "overdue";
  const date = invoice.dueOn ? f.shortDay(invoice.dueOn) : "—";
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3.5 text-[13.5px]",
        overdue ? "border-bad/30 bg-bad-soft text-bad" : "border-warn/30 bg-warn-soft text-warn",
      )}
    >
      <Clock aria-hidden className="mt-0.5 size-5 flex-none" />
      <p className="m-0 min-w-0 flex-1">
        <b>
          {overdue
            ? t("overdue", { date, ago: tp("overdueFor", { days: invoice.overdueDays ?? 0 }) })
            : t("dueIn", { date, in: tp("dueIn", { days: invoice.dueOn ? daysBetween(invoice.today, invoice.dueOn) : 0 }) })}
        </b>{" "}
        {t("owed", { left: f.money(invoice.outstandingCents), payable: f.money(invoice.payableCents) })}
      </p>
    </div>
  );
}

export type PaymentValues = {
  paidOn: string;
  amountCents: number;
  method: PurchasePaymentMethod;
  reference: string;
  file: File | null;
};

/** The day the money went out (≤ today), how much (what is owed by default), how, and its proof. */
export function PaymentForm({
  invoice,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  invoice: PurchaseInvoiceDetail;
  pending: boolean;
  error?: string;
  onSubmit: (values: PaymentValues) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("purchasing.invoice.payForm");
  const tm = useTranslations("purchasing.method");
  const f = usePurchaseFormat();
  // What is due first; once paid, what is left is the retention.
  const owed = invoice.outstandingCents > 0 ? invoice.outstandingCents : invoice.payableLeftCents;
  const [paidOn, setPaidOn] = useState(invoice.today);
  const [amount, setAmount] = useState(f.decimal(owed / 100));
  const [method, setMethod] = useState<PurchasePaymentMethod>("transfer");
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const amountCents = f.hundredths(amount);
  return (
    <form
      aria-labelledby="pay-form-title"
      className={cn(cardVariants(), "border-primary/40")}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ paidOn, amountCents, method, reference, file });
      }}
    >
      <div>
        <h2 id="pay-form-title" className="text-[22px]">
          {t("title")}
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">{t("hint")}</p>
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <Field>
          <Label htmlFor="pay-date">{t("paidOn")}</Label>
          <Input id="pay-date" type="date" required value={paidOn} min={invoice.issuedOn} max={invoice.today} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <Field>
          <Label htmlFor="pay-amount">{t("amount")}</Label>
          <Input id="pay-amount" className="num text-right" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          <FieldDescription>{invoice.outstandingCents > 0 ? t("amountHint") : t("retentionHint")}</FieldDescription>
        </Field>
        <Field>
          <Label htmlFor="pay-method">{t("method")}</Label>
          <NativeSelect id="pay-method" className="w-full" value={method} onChange={(e) => setMethod(e.target.value as PurchasePaymentMethod)}>
            {PURCHASE_PAYMENT_METHODS.map((m) => (
              <NativeSelectOption key={m} value={m}>
                {tm(m)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <Label htmlFor="pay-reference">{t("reference")}</Label>
          <Input id="pay-reference" value={reference} maxLength={120} placeholder={t("referencePlaceholder")} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      <Field>
        <Label htmlFor="pay-proof">{t("proof")}</Label>
        <FileSlot id="pay-proof" label={t("chooseFile")} file={file} onChange={setFile} namespace="purchasing.invoice.payForm" errorNamespace="purchasing.errors" />
      </Field>
      <FormError namespace="purchasing.errors" error={error} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending || !(amountCents > 0)}>
          {pending ? t("saving") : t("confirm", { amount: Number.isFinite(amountCents) ? f.money(amountCents) : "—" })}
        </Button>
      </FormActions>
    </form>
  );
}

/** An invoice's amounts: base, VAT, IRPF, total, retention and what is due ("—" while not an amount). */
export function InvoiceAmountsList({
  amounts,
  vatKind,
  children,
}: {
  amounts: PurchaseInvoiceAmounts | null;
  vatKind: PurchaseVatKind;
  /** Rows after what is due. */
  children?: React.ReactNode;
}) {
  const t = useTranslations("purchasing.invoice.amounts");
  const tv = useTranslations("purchasing.vat");
  const f = usePurchaseFormat();
  return (
    <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-[13.5px]">
      <AmountRow label={t("base")} cents={amounts?.baseCents} />
      <AmountRow label={t("vat", { kind: tv(vatKind) })} cents={amounts?.vatCents} />
      {amounts && amounts.irpfCents !== 0 && <AmountRow label={t("irpf", { pct: f.share(amounts.irpfBp) })} cents={-amounts.irpfCents} />}
      <AmountRow label={t("total")} cents={amounts?.totalCents} strong />
      {amounts && amounts.retentionCents !== 0 && (
        <AmountRow label={t("retention", { pct: f.share(amounts.retentionBp) })} cents={-amounts.retentionCents} />
      )}
      <div className="col-span-2 border-t-2 border-foreground" />
      <AmountRow label={t("payable")} cents={amounts?.payableCents} strong />
      {children}
    </dl>
  );
}

export function AmountRow({ label, cents, strong = false }: { label: string; cents: number | undefined; strong?: boolean }) {
  const f = usePurchaseFormat();
  return (
    <div className="contents">
      <dt className={cn("text-muted-foreground", strong && "font-semibold text-foreground")}>{label}</dt>
      <dd className={cn("num m-0 text-right", strong && "font-semibold")}>{cents === undefined ? "—" : f.amount(cents)}</dd>
    </div>
  );
}

/** Its amounts, then what is paid and still owed. */
export function AmountsCard({ invoice }: { invoice: PurchaseInvoiceDetail }) {
  const t = useTranslations("purchasing.invoice.amounts");
  const f = usePurchaseFormat();
  const credits = invoice.creditNotes.reduce((sum, c) => sum + c.payableCents, 0);
  const owed = invoice.payableCents + credits;
  return (
    <section className={cardVariants()} aria-labelledby="amounts-title">
      <h2 id="amounts-title" className="text-[22px]">
        {t("title")}
      </h2>
      <InvoiceAmountsList amounts={invoice} vatKind={invoice.vatKind}>
        {credits !== 0 && <AmountRow label={t("credits")} cents={credits} />}
      </InvoiceAmountsList>
      {invoice.kind === "invoice" && (
        <div className="flex flex-col gap-1.5">
          <ProgressBar pct={owed > 0 ? (invoice.paidCents * 100) / owed : 0} />
          <div className="flex flex-wrap justify-between gap-2 text-[13px]">
            <span>
              {t("paid")} <b className="num text-good">{f.amount(invoice.paidCents)}</b>
            </span>
            <span>
              {invoice.outstandingCents < 0 ? t("inFavour") : t("outstanding")}{" "}
              <b className={cn("num", invoice.outstandingCents > 0 ? "text-warn" : "text-muted-foreground")}>
                {f.amount(Math.abs(invoice.outstandingCents))}
              </b>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

/** Its dates, obra, order, milestone, the lines it splits across and who registered it. */
export function InvoiceData({ invoice }: { invoice: PurchaseInvoiceDetail }) {
  const t = useTranslations("purchasing.invoice.data");
  const f = usePurchaseFormat();
  const rows: [string, React.ReactNode][] = [
    [t("issuedOn"), <span key="i" className="num">{f.date(invoice.issuedOn)}</span>],
    ...(invoice.dueOn ? ([[t("dueOn"), <span key="d" className="num">{f.date(invoice.dueOn)}</span>]] as [string, React.ReactNode][]) : []),
    [t("project"), <><span className="num">{invoice.projectRef}</span> · {invoice.projectAddress}</>],
    [
      t("order"),
      <Link key="o" href={orderHref(invoice.projectId, invoice.orderId)} className="text-brand-ink hover:text-primary">
        <span className="num">{orderLabel(invoice.orderNumber)}</span> {invoice.orderDescription}
      </Link>,
    ],
    ...(invoice.milestoneConcept ? ([[t("milestone"), invoice.milestoneConcept]] as [string, React.ReactNode][]) : []),
    ...(invoice.rectifiesId
      ? ([[
          t("rectifies"),
          <Link key="r" href={invoiceHref(invoice.rectifiesId)} className="num font-semibold text-brand-ink hover:text-primary">
            {invoice.rectifiesNumber}
          </Link>,
        ]] as [string, React.ReactNode][])
      : []),
    [
      t("lines"),
      <ul key="l" className="m-0 flex list-none flex-col gap-1 p-0">
        {invoice.lines.map((line) => (
          <li key={line.lineageId} className="flex flex-wrap gap-x-2">
            <span className="num text-muted-foreground">{line.code ?? line.chapterCode}</span>
            <span className="min-w-0 flex-1">{line.description ?? "—"}</span>
            <span className="num">{f.amount(line.amountCents)}</span>
          </li>
        ))}
      </ul>,
    ],
    ...(invoice.notes ? ([[t("notes"), <span key="n" className="whitespace-pre-line">{invoice.notes}</span>]] as [string, React.ReactNode][]) : []),
    [t("createdBy"), `${invoice.createdBy ?? "—"} · ${f.shortDay(day(invoice.createdAt))}`],
  ];
  return (
    <section className={cardVariants()} aria-labelledby="invoice-data-title">
      <h2 id="invoice-data-title" className="text-[22px]">
        {t("title")}
      </h2>
      <dl className="m-0 grid grid-cols-[minmax(0,110px)_minmax(0,1fr)] gap-x-3.5 gap-y-2.5 text-[13.5px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Its PDF's versions, the current one first; a manager adds a new one with its reason. */
export function InvoiceFiles({
  invoice,
  canUpload,
  pending,
  error,
  onUpload,
}: {
  invoice: PurchaseInvoiceDetail;
  canUpload: boolean;
  pending: boolean;
  error?: string;
  /** `done` closes the form once it is in. */
  onUpload: (file: File, note: string, done: () => void) => void;
}) {
  const t = useTranslations("purchasing.invoice.files");
  const f = usePurchaseFormat();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const close = () => {
    setOpen(false);
    setFile(null);
    setNote("");
  };
  return (
    <section className={cardVariants()} aria-labelledby="invoice-files-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="invoice-files-title" className="text-[22px]">
          {t("title")}
        </h2>
        {canUpload && !open && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
            {invoice.files.length > 0 ? t("newVersion") : t("upload")}
          </Button>
        )}
      </div>
      {invoice.files.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {invoice.files.map((file, index) => (
            <li key={file.id} className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b py-2.5 text-[13px] last:border-b-0", index > 0 && "text-muted-foreground")}>
              <a href={invoiceFileUrl(invoice.id, index === 0 ? undefined : file.id)} download className={cn("inline-flex items-center gap-1.5 font-semibold", index === 0 ? "text-brand-ink hover:text-primary" : "hover:text-foreground")}>
                <FileText aria-hidden className="size-4 flex-none" />
                {file.filename}
              </a>
              <span className="rounded-full bg-raise px-2 py-px text-[11.5px] font-semibold">
                {index === 0 ? t("current", { version: file.version }) : t("version", { version: file.version })}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {f.shortDay(day(file.at))} · {f.fileSize(file.sizeBytes)}
                {file.by && ` · ${file.by}`}
                {invoice.files[index - 1]?.note && index > 0 && ` · ${t("replaced")}: «${invoice.files[index - 1]!.note}»`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <form
          aria-label={t("newVersion")}
          className="flex flex-col gap-3 rounded-xl border bg-raise p-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (file) onUpload(file, note, close);
          }}
        >
          <Field>
            <Label htmlFor="invoice-file">{t("file")}</Label>
            <FileSlot id="invoice-file" label={t("chooseFile")} file={file} onChange={setFile} namespace="purchasing.invoice.files" errorNamespace="purchasing.errors" />
          </Field>
          <Field>
            <Label htmlFor="invoice-file-note">{t("note")}</Label>
            <Input id="invoice-file-note" value={note} maxLength={300} placeholder={t("notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <FormError namespace="purchasing.errors" error={error} />
          <FormActions>
            <Button type="button" variant="outline" onClick={close}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending || !file}>
              {t("save")}
            </Button>
          </FormActions>
        </form>
      )}
      <p className="m-0 text-[12.5px] text-muted-foreground">{t("keepAll")}</p>
    </section>
  );
}

/** The credit notes rectifying it. */
export function CreditNotes({ invoice }: { invoice: PurchaseInvoiceDetail }) {
  const t = useTranslations("purchasing.invoice.credits");
  const f = usePurchaseFormat();
  if (invoice.creditNotes.length === 0) return null;
  return (
    <section className={cardVariants()} aria-labelledby="credit-notes-title">
      <h2 id="credit-notes-title" className="text-[22px]">
        {t("title")}
      </h2>
      <ul className="m-0 list-none p-0">
        {invoice.creditNotes.map((credit) => (
          <li key={credit.id} className="flex flex-wrap items-center gap-x-2.5 border-b py-2 text-[13px] last:border-b-0">
            <Link href={invoiceHref(credit.id)} className="num font-semibold text-brand-ink hover:text-primary">
              {credit.number}
            </Link>
            <span className="text-muted-foreground">{f.shortDay(credit.issuedOn)}</span>
            <span className="num ml-auto">{f.amount(credit.payableCents)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
