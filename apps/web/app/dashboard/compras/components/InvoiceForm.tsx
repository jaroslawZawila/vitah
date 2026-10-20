"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  PURCHASE_INVOICE_KINDS,
  PURCHASE_VAT_KINDS,
  orderLabel,
  type PurchaseInvoiceForm,
} from "@repo/core/contract";
import { Button, buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import FormError from "../../components/FormError";
import FileSlot from "../../subcontratas/empresas/nueva/steps/FileSlot";
import ProgressBar from "../../projects/[id]/components/obra/ProgressBar";
import { InvoiceAmountsList } from "./InvoiceDetailViews";
import Segmented from "../../projects/[id]/components/construction/Segmented";
import { usePurchaseFormat } from "../../projects/[id]/components/purchasing/format";
import { suppliersOf } from "../../projects/[id]/components/purchasing/orders";
import {
  draftAmounts,
  draftBase,
  draftDueOn,
  draftSplit,
  splitMatches,
  type InvoiceDraft,
  type Parse,
} from "./invoice-draft";

// Presentational: the supplier invoice (or credit note) form, new or edited.
// The container (InvoiceFormScreen) holds the draft and saves it.

const section = cn(cardVariants(), "gap-3.5");
const option =
  "group flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-[10px] border bg-card px-3.5 py-3 text-left text-[13.5px] transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:bg-raise disabled:opacity-60 aria-checked:border-primary aria-checked:bg-brand-soft";
const dot =
  "size-4 flex-none rounded-full border-2 border-border bg-card group-aria-checked:border-primary group-aria-checked:bg-primary group-aria-checked:shadow-[inset_0_0_0_3px_var(--card)]";

type Order = NonNullable<PurchaseInvoiceForm["order"]>;

function Heading({ id, children, hint }: { id: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div>
      <h2 id={id} className="text-[22px]">
        {children}
      </h2>
      {hint && <p className="mt-1 text-[12.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Step 1: the document's kind, its order (supplier first), number and dates; a credit note's invoice. */
function OrderAndNumber({
  form,
  draft,
  onChange,
  supplierId,
  onSupplier,
  onOrder,
  editing,
}: {
  form: PurchaseInvoiceForm;
  draft: InvoiceDraft;
  onChange: (patch: Partial<InvoiceDraft>) => void;
  supplierId: string;
  onSupplier: (id: string) => void;
  onOrder: (id: string) => void;
  editing: boolean;
}) {
  const t = useTranslations("purchasing.invoiceForm");
  const f = usePurchaseFormat();
  const order = form.order;
  const suppliers = suppliersOf(form.orders);
  const orders = form.orders.filter((o) => !supplierId || o.subcontractorId === supplierId);
  const credit = draft.kind === "credit_note";
  const rectifiable = order?.invoices.filter((i) => i.kind === "invoice") ?? [];
  return (
    <section className={section} aria-labelledby="invoice-order">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <Heading id="invoice-order">{t("orderTitle")}</Heading>
        {!editing && (
          <Segmented
            label={t("kind")}
            value={draft.kind}
            onChange={(kind) => onChange({ kind })}
            options={PURCHASE_INVOICE_KINDS.map((key) => ({ key, label: t(`kinds.${key}`) }))}
          />
        )}
      </div>
      {form.orders.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("noOrders")}</p>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field>
            <Label htmlFor="invoice-supplier">{t("supplier")}</Label>
            <NativeSelect id="invoice-supplier" className="w-full" value={supplierId} disabled={editing} onChange={(e) => onSupplier(e.target.value)}>
              <NativeSelectOption value="">{t("chooseSupplier")}</NativeSelectOption>
              {suppliers.map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>
                  {s.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <Label htmlFor="invoice-order-select">{t("order")}</Label>
            <NativeSelect id="invoice-order-select" className="w-full" value={order?.id ?? ""} disabled={editing} onChange={(e) => onOrder(e.target.value)}>
              <NativeSelectOption value="">{t("chooseOrder")}</NativeSelectOption>
              {orders.map((o) => (
                <NativeSelectOption key={o.id} value={o.id}>
                  {`${o.projectRef} · ${orderLabel(o.number)} ${o.description} · ${f.amount(o.amountCents)}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>{t("orderHint")}</FieldDescription>
          </Field>
        </div>
      )}
      {order && (
        <>
          <div className="grid gap-3.5 sm:grid-cols-3">
            <Field>
              <Label htmlFor="invoice-number">{credit ? t("creditNumber") : t("number")}</Label>
              <Input id="invoice-number" className="num" required maxLength={60} value={draft.number} onChange={(e) => onChange({ number: e.target.value })} />
            </Field>
            <Field>
              <Label htmlFor="invoice-issued">{t("issuedOn")}</Label>
              <Input id="invoice-issued" type="date" required max={form.today} value={draft.issuedOn} onChange={(e) => onChange({ issuedOn: e.target.value })} />
            </Field>
            {!credit && (
              <Field>
                <Label htmlFor="invoice-due">{t("dueOn")}</Label>
                <Input
                  id="invoice-due"
                  type="date"
                  min={draft.issuedOn || undefined}
                  value={draftDueOn(draft, order.terms.paymentDays)}
                  onChange={(e) => onChange({ dueOn: e.target.value })}
                />
                <FieldDescription>{t("dueOnHint", { days: order.terms.paymentDays })}</FieldDescription>
              </Field>
            )}
          </div>
          {credit && (
            <Field>
              <Label htmlFor="invoice-rectifies">{t("rectifies")}</Label>
              {rectifiable.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">{t("noInvoices")}</p>
              ) : (
                <NativeSelect id="invoice-rectifies" className="w-full" value={draft.rectifiesId} disabled={editing} onChange={(e) => onChange({ rectifiesId: e.target.value })}>
                  <NativeSelectOption value="">{t("chooseInvoice")}</NativeSelectOption>
                  {rectifiable.map((i) => (
                    <NativeSelectOption key={i.id} value={i.id}>
                      {`${i.number}${i.milestoneConcept ? ` · ${i.milestoneConcept}` : ""} · ${f.amount(i.baseCents)}`}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
              <FieldDescription>{t("rectifiesHint")}</FieldDescription>
            </Field>
          )}
          <Field>
            <Label htmlFor="invoice-notes">{t("notes")}</Label>
            <Input id="invoice-notes" maxLength={2000} value={draft.notes} onChange={(e) => onChange({ notes: e.target.value })} />
          </Field>
        </>
      )}
    </section>
  );
}

/** Step 2 (an order with a schedule): the milestone it invoices; its amount left suggests the base. */
function Milestone({
  order,
  draft,
  step,
  locked,
  onPick,
}: {
  order: Order;
  draft: InvoiceDraft;
  step: number;
  locked: boolean;
  onPick: (milestoneId: string, leftCents: number) => void;
}) {
  const t = useTranslations("purchasing.invoiceForm");
  const f = usePurchaseFormat();
  return (
    <section className={section} aria-labelledby="invoice-milestone">
      <Heading id="invoice-milestone" hint={t("milestoneHint", { count: order.milestones.length })}>
        {t("milestoneTitle", { n: step })}
      </Heading>
      <div role="radiogroup" aria-label={t("milestones")} className="flex flex-col gap-2">
        {order.milestones.map((m, index) => {
          const left = m.amountCents - m.invoicedCents;
          const chosen = draft.milestoneId === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={chosen}
              disabled={locked || (left <= 0 && !chosen)}
              onClick={() => onPick(m.id, Math.max(0, left))}
              className={option}
            >
              <span aria-hidden className={dot} />
              <span className="min-w-0 flex-1">
                <b>
                  {index + 1}. {m.concept}
                </b>{" "}
                <span className="text-[12.5px] text-muted-foreground">
                  · {m.invoices.length > 0 ? t("milestoneInvoiced", { numbers: m.invoices.map((i) => i.number).join(", ") }) : t("milestoneLeft")}
                </span>
              </span>
              <span className="num font-semibold">{f.amount(m.amountCents)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Step 3: the base, the retention, IRPF (self-employed only) and VAT. */
function Amounts({
  order,
  draft,
  step,
  locked,
  onChange,
}: {
  order: Order;
  draft: InvoiceDraft;
  step: number;
  locked: boolean;
  onChange: (patch: Partial<InvoiceDraft>) => void;
}) {
  const t = useTranslations("purchasing.invoiceForm");
  const tv = useTranslations("purchasing.vat");
  const th = useTranslations("purchasing.vatHint");
  const credit = draft.kind === "credit_note";
  const selfEmployed = order.supplierKind === "self_employed" || draft.irpf.trim() !== "";
  return (
    <section className={section} aria-labelledby="invoice-amounts">
      <Heading id="invoice-amounts">{t("amountsTitle", { n: step })}</Heading>
      <div className="grid gap-3.5 sm:grid-cols-3">
        <Field>
          <Label htmlFor="invoice-base">{credit ? t("baseCredit") : t("base")}</Label>
          <Input id="invoice-base" className="num text-right" inputMode="decimal" required disabled={locked} value={draft.base} onChange={(e) => onChange({ base: e.target.value })} />
          <FieldDescription>{t("baseHint")}</FieldDescription>
        </Field>
        <Field>
          <Label htmlFor="invoice-retention">{t("retention")}</Label>
          <Input id="invoice-retention" className="num text-right" inputMode="decimal" placeholder="0" disabled={locked} value={draft.retention} onChange={(e) => onChange({ retention: e.target.value })} />
          <FieldDescription>{t("retentionHint")}</FieldDescription>
        </Field>
        {selfEmployed && (
          <Field>
            <Label htmlFor="invoice-irpf">{t("irpf")}</Label>
            <Input id="invoice-irpf" className="num text-right" inputMode="decimal" placeholder="0" disabled={locked} value={draft.irpf} onChange={(e) => onChange({ irpf: e.target.value })} />
            <FieldDescription>{t("irpfHint")}</FieldDescription>
          </Field>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">{t("vat")}</span>
        <div role="group" aria-label={t("vat")} className="flex flex-wrap gap-2">
          {PURCHASE_VAT_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={draft.vatKind === kind}
              disabled={locked}
              onClick={() => onChange({ vatKind: kind })}
              className="inline-flex min-h-10 cursor-pointer items-center rounded-full border bg-card px-3.5 text-[13px] font-semibold transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-11 aria-pressed:border-rail aria-pressed:bg-rail aria-pressed:text-white"
            >
              {tv(kind)}
            </button>
          ))}
        </div>
        <span className="text-[12.5px] text-muted-foreground">{th(draft.vatKind)}</span>
      </div>
    </section>
  );
}

/** Step 4 (an invoice of an order with several lines): its base split across them, in proportion unless typed. */
function Split({
  order,
  draft,
  step,
  parse,
  locked,
  onChange,
}: {
  order: Order;
  draft: InvoiceDraft;
  step: number;
  parse: Parse;
  locked: boolean;
  onChange: (patch: Partial<InvoiceDraft>) => void;
}) {
  const t = useTranslations("purchasing.invoiceForm");
  const f = usePurchaseFormat();
  const split = draftSplit(draft, order, parse);
  const base = draftBase(draft, parse);
  const sum = split.reduce((total, l) => total + (Number.isFinite(l.cents) ? l.cents : 0), 0);
  const typed = (lineageId: string) => draft.lines?.[lineageId] ?? f.decimal((split.find((l) => l.lineageId === lineageId)?.cents ?? 0) / 100);
  return (
    <section className={cn(section, "pb-2")} aria-labelledby="invoice-split">
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <Heading id="invoice-split" hint={t("splitHint")}>
          {t("splitTitle", { n: step })}
        </Heading>
        {draft.lines && !locked && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ lines: null })}>
            {t("resplit")}
          </Button>
        )}
      </div>
      <div className="-mx-[18px]">
        <Table className="min-w-[640px] text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-[18px]">{t("line")}</TableHead>
              <TableHead className="text-right">{t("contracted")}</TableHead>
              <TableHead className="text-right">{t("invoiced")}</TableHead>
              <TableHead className="pr-[18px] text-right">{t("thisInvoice")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.lines.map((line) => (
              <TableRow key={line.lineageId}>
                <TableCell className="pl-[18px] whitespace-normal">
                  <span className="num text-muted-foreground">{line.code ?? line.chapterCode}</span> {line.description ?? "—"}
                </TableCell>
                <TableCell className="num text-right">{f.amount(line.amountCents)}</TableCell>
                <TableCell className="num text-right">{f.amount(line.invoicedCents)}</TableCell>
                <TableCell className="pr-[18px] text-right">
                  <Input
                    aria-label={t("amountOf", { code: line.code ?? line.chapterCode })}
                    className="num ml-auto w-[140px] text-right"
                    inputMode="decimal"
                    disabled={locked}
                    value={typed(line.lineageId)}
                    onChange={(e) =>
                      onChange({
                        lines: {
                          ...Object.fromEntries(order.lines.map((l) => [l.lineageId, typed(l.lineageId)])),
                          [line.lineageId]: e.target.value,
                        },
                      })
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {!splitMatches(draft, order, parse) && (
        <p role="alert" className="text-[12.5px] font-semibold text-bad">
          {t("splitMismatch", { sum: f.amount(sum), base: Number.isFinite(base) ? f.amount(base) : "—" })}
        </p>
      )}
    </section>
  );
}

/** The order's invoicing after this one, the document's totals and what falls due. */
function Summary({
  order,
  draft,
  parse,
  previousBaseCents,
  rectifiedNumber,
  pending,
  error,
  saveLabel,
  cancelHref,
  canSave,
}: {
  order: Order;
  draft: InvoiceDraft;
  parse: Parse;
  /** The edited invoice's base, already counted in the order's invoicing. */
  previousBaseCents: number;
  rectifiedNumber: string | null;
  pending: boolean;
  error: string | null;
  saveLabel: string;
  cancelHref: string;
  canSave: boolean;
}) {
  const t = useTranslations("purchasing.invoiceForm");
  const f = usePurchaseFormat();
  const amounts = draftAmounts(draft, parse);
  const after = order.invoicing.invoicedCents - previousBaseCents + (amounts?.baseCents ?? 0);
  const due = draftDueOn(draft, order.terms.paymentDays);
  return (
    <aside aria-labelledby="invoice-summary" className={cn(cardVariants(), "gap-4 lg:sticky lg:top-6")}>
      <h2 id="invoice-summary" className="text-[22px]">
        {t("summary")}
      </h2>
      <div className="flex flex-col gap-1.5">
        <ProgressBar pct={order.amountCents ? (after * 100) / order.amountCents : 0} tone="brand" />
        <div className="flex justify-between gap-2 text-[12.5px] text-muted-foreground">
          <span>{t("progress")}</span>
          <span className="num font-semibold text-foreground">{t("progressOf", { amount: f.amount(after), total: f.amount(order.amountCents) })}</span>
        </div>
        <span className={cn("text-[12.5px] font-semibold", after > order.amountCents ? "text-warn" : after === order.amountCents ? "text-good" : "text-muted-foreground")}>
          {after > order.amountCents
            ? t("over", { amount: f.amount(after - order.amountCents) })
            : after === order.amountCents
              ? t("complete")
              : t("left", { amount: f.amount(order.amountCents - after) })}
        </span>
      </div>
      <InvoiceAmountsList amounts={amounts} vatKind={draft.vatKind} />
      <p className="m-0 text-[12.5px] text-muted-foreground">
        {draft.kind === "credit_note"
          ? rectifiedNumber && t("creditNote", { number: rectifiedNumber })
          : due && t("dueNote", { date: f.shortDay(due) })}
      </p>
      <FormError namespace="purchasing.errors" error={error} />
      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={pending || !canSave}>
          {pending ? t("saving") : saveLabel}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          {t("cancel")}
        </Link>
      </div>
    </aside>
  );
}

/** Presentational: the invoice form; steps numbered by what the order needs. */
export default function InvoiceForm({
  form,
  draft,
  parse,
  onChange,
  supplierId,
  onSupplier,
  onOrder,
  editing,
  locked,
  pending,
  error,
  canSave,
  onSave,
  cancelHref,
}: {
  form: PurchaseInvoiceForm;
  draft: InvoiceDraft;
  parse: Parse;
  onChange: (patch: Partial<InvoiceDraft>) => void;
  supplierId: string;
  onSupplier: (id: string) => void;
  onOrder: (id: string) => void;
  /** Editing an invoice: its kind, order and credit note's invoice stay. */
  editing: boolean;
  /** It has payments: only its number, dates and notes can change. */
  locked: boolean;
  pending: boolean;
  error: string | null;
  canSave: boolean;
  onSave: () => void;
  cancelHref: string;
}) {
  const t = useTranslations("purchasing.invoiceForm");
  const f = usePurchaseFormat();
  const order = form.order;
  const credit = draft.kind === "credit_note";
  const withMilestone = !!order && !credit && order.milestones.length > 0;
  const withSplit = !!order && !credit && order.lines.length > 1;
  let step = 1;
  const next = () => ++step;
  const rectified = order?.invoices.find((i) => i.id === draft.rectifiesId) ?? null;
  return (
    <form
      noValidate
      aria-label={t("label")}
      className="flex flex-wrap items-start gap-[18px]"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-[18px]">
        <OrderAndNumber
          form={form}
          draft={draft}
          onChange={onChange}
          supplierId={supplierId}
          onSupplier={onSupplier}
          onOrder={onOrder}
          editing={editing}
        />
        {locked && (
          <p role="status" className="m-0 rounded-xl bg-warn-soft px-4 py-3 text-[13.5px] text-warn">
            {t("paidLocked")}
          </p>
        )}
        {order && (
          <>
            {withMilestone && (
              <Milestone
                order={order}
                draft={draft}
                step={next()}
                locked={locked}
                // A new invoice's base starts at what is left of the milestone.
                onPick={(milestoneId, left) => onChange({ milestoneId, ...(left > 0 && !editing ? { base: f.decimal(left / 100) } : {}) })}
              />
            )}
            <Amounts order={order} draft={draft} step={next()} locked={locked} onChange={onChange} />
            {withSplit && <Split order={order} draft={draft} step={next()} parse={parse} locked={locked} onChange={onChange} />}
            {!editing && (
              <section className={section} aria-labelledby="invoice-document">
                <Heading id="invoice-document" hint={t("documentHint")}>
                  {t("documentTitle", { n: next() })}{" "}
                  <span className="font-sans text-[13px] font-normal tracking-normal text-muted-foreground">{t("optional")}</span>
                </Heading>
                <FileSlot
                  id="invoice-file"
                  label={t("chooseFile")}
                  file={draft.file}
                  onChange={(file) => onChange({ file })}
                  namespace="purchasing.invoiceForm"
                  errorNamespace="purchasing.errors"
                />
              </section>
            )}
          </>
        )}
      </div>
      {order && (
        <div className="min-w-0 flex-[1_1_320px] self-stretch">
          <Summary
            order={order}
            draft={draft}
            parse={parse}
            previousBaseCents={editing ? (form.editing?.baseCents ?? 0) : 0}
            rectifiedNumber={rectified?.number ?? null}
            pending={pending}
            error={error}
            saveLabel={editing ? t("saveChanges") : credit ? t("saveCredit") : t("save")}
            cancelHref={cancelHref}
            canSave={canSave}
          />
        </div>
      )}
    </form>
  );
}
