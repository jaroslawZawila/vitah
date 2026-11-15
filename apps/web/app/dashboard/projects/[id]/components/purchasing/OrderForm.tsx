"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  PURCHASE_VAT_KINDS,
  defaultVatKind,
  placedStatus,
  type PurchaseForm,
} from "@repo/core/contract";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import FormError from "../../../../components/FormError";
import FileSlot from "../../../../subcontratas/empresas/nueva/steps/FileSlot";
import { deviationTone } from "../construction/format";
import { MockBadge } from "../construction/pills";
import { orderTotals, type OrderDraft, type ParseAmount } from "./draft";
import { usePurchaseFormat } from "./format";
import { KindAndSupplier, Lines, section } from "./OrderSteps";

/** Step 2: the concept and the supplier's dates (never the obra's). */
function ConceptAndDates({
  form,
  draft,
  onChange,
  showOrderedOn,
}: {
  form: PurchaseForm;
  draft: OrderDraft;
  onChange: (patch: Partial<OrderDraft>) => void;
  showOrderedOn: boolean;
}) {
  const t = useTranslations("purchasing.form");
  const tp = useTranslations("planning");
  const f = usePurchaseFormat();
  const chapter = form.chapters.find((c) => c.code === draft.chapter);
  const date = (key: "orderedOn" | "expectedOn" | "workStart" | "workEnd", props: React.ComponentProps<typeof Input> = {}) => (
    <Field>
      <Label htmlFor={`form-${key}`}>{t(key)}</Label>
      <Input id={`form-${key}`} type="date" value={draft[key]} onChange={(e) => onChange({ [key]: e.target.value })} {...props} />
      {key === "orderedOn" && <FieldDescription>{t("orderedOnHint")}</FieldDescription>}
    </Field>
  );

  return (
    <section className={section} aria-labelledby="form-concept">
      <h2 id="form-concept" className="text-[22px]">
        {t("conceptTitle")}
      </h2>
      <Field>
        <Label htmlFor="form-description">{t("description")}</Label>
        <Input
          id="form-description"
          required
          maxLength={500}
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </Field>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {showOrderedOn && date("orderedOn", { max: form.today })}
        {draft.kind === "material"
          ? date("expectedOn")
          : (
              <>
                {date("workStart", { max: draft.workEnd || undefined })}
                {date("workEnd", { min: draft.workStart || undefined })}
              </>
            )}
      </div>
      <p className="flex flex-wrap items-center gap-1.5 text-meta text-muted-foreground">
        {chapter?.plannedStart && chapter.plannedEnd && (
          <>
            {t("chapterPlanned", { code: chapter.code, range: f.dateRange(chapter.plannedStart, chapter.plannedEnd) })}
            {chapter.orderBy && <> · {tp("orderBy", { date: f.date(chapter.orderBy) })}</>}
            {form.sources.planning === "mock" && <MockBadge />}
          </>
        )}
        {t("datesNote")}
      </p>
    </section>
  );
}

/** Step 4: what its invoices will start from (each invoice may say otherwise). */
function Terms({ draft, onChange }: { draft: OrderDraft; onChange: (patch: Partial<OrderDraft>) => void }) {
  const t = useTranslations("purchasing.form");
  const tv = useTranslations("purchasing.vat");
  return (
    <section className={section} aria-labelledby="form-terms">
      <div>
        <h2 id="form-terms" className="text-[22px]">
          {t("termsTitle")}
        </h2>
        <p className="mt-1 text-meta text-muted-foreground">{t("termsHint")}</p>
      </div>
      <div className="grid gap-3.5 sm:grid-cols-3">
        <Field>
          <Label htmlFor="form-payment-days">{t("paymentDays")}</Label>
          <Input
            id="form-payment-days"
            inputMode="numeric"
            className="num"
            placeholder="30"
            value={draft.paymentDays}
            onChange={(e) => onChange({ paymentDays: e.target.value })}
          />
          <FieldDescription>{t("paymentDaysHint")}</FieldDescription>
        </Field>
        <Field>
          <Label htmlFor="form-retention">{t("retention")}</Label>
          <Input
            id="form-retention"
            inputMode="decimal"
            className="num"
            placeholder="0"
            value={draft.retention}
            onChange={(e) => onChange({ retention: e.target.value })}
          />
          <FieldDescription>{t("retentionHint")}</FieldDescription>
        </Field>
        <Field>
          <Label htmlFor="form-vat">{t("vatKind")}</Label>
          <NativeSelect
            id="form-vat"
            className="w-full"
            value={draft.vatKind}
            onChange={(e) => onChange({ vatKind: e.target.value as OrderDraft["vatKind"] })}
          >
            <NativeSelectOption value="">{t("vatDefault", { vat: tv(defaultVatKind(draft.kind)) })}</NativeSelectOption>
            {PURCHASE_VAT_KINDS.map((kind) => (
              <NativeSelectOption key={kind} value={kind}>
                {tv(kind)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>
    </section>
  );
}

/** Step 5 (new orders): the order or signed contract as a PDF, uploaded once the order exists. */
function DocumentPicker({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
  const t = useTranslations("purchasing.form");
  return (
    <section className={section} aria-labelledby="form-document">
      <h2 id="form-document" className="text-[22px]">
        {t("documentTitle")} <span className="font-sans text-sm font-normal tracking-normal text-muted-foreground">{t("optional")}</span>
      </h2>
      <p className="text-sm text-muted-foreground">{t("documentHint")}</p>
      <FileSlot
        id="form-file"
        label={t("chooseFile")}
        file={file}
        onChange={onChange}
        namespace="purchasing.form"
        errorNamespace="purchasing.errors"
      />
    </section>
  );
}

/**
 * Presentational: the new / edit order form. A new order saves as pending or
 * placed (ordered / contracted) at once; an edited one keeps its status.
 */
export default function OrderForm({
  form,
  draft,
  parse,
  onChange,
  editing,
  pending,
  error,
  onSave,
  cancelHref,
}: {
  form: PurchaseForm;
  draft: OrderDraft;
  parse: ParseAmount;
  onChange: (patch: Partial<OrderDraft>) => void;
  /** Editing an order: whether it is still pending (its kind can change, its order date isn't set yet). */
  editing?: { pending: boolean };
  pending: boolean;
  error?: string | null;
  /** `placed`: a new order saved as ordered / contracted. */
  onSave: (placed: boolean) => void;
  cancelHref: string;
}) {
  const t = useTranslations("purchasing.form");
  const f = usePurchaseFormat();
  const totals = orderTotals(form, draft, parse);
  return (
    <form
      noValidate
      aria-label={editing ? t("editLabel") : t("newLabel")}
      className="flex flex-col gap-[18px]"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(!editing);
      }}
    >
      <KindAndSupplier form={form} draft={draft} onChange={onChange} kindLocked={!!editing && !editing.pending} />
      <ConceptAndDates form={form} draft={draft} onChange={onChange} showOrderedOn={!editing || !editing.pending} />
      <Lines form={form} draft={draft} parse={parse} onChange={onChange} />
      <Terms draft={draft} onChange={onChange} />
      {!editing && <DocumentPicker file={draft.file} onChange={(file) => onChange({ file })} />}

      <div
        role="region"
        aria-label={t("totalLabel")}
        className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-card px-[18px] py-3.5 shadow-card"
      >
        <div>
          <div className="eyebrow">{t("total")}</div>
          <div className="num text-[22px] font-semibold">{f.money(totals.totalCents)}</div>
        </div>
        <div>
          <div className="eyebrow">{t("deviationOn", { count: totals.closed })}</div>
          <div className={cn("num text-base font-semibold", deviationTone(totals.deviationCents))}>
            {totals.deviationCents === null ? "—" : f.signedMoney(totals.deviationCents)}
          </div>
        </div>
        <div className="flex w-full flex-col-reverse gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:flex-wrap">
          {editing ? (
            <>
              <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
                {t("cancel")}
              </Link>
              <Button type="submit" disabled={pending}>
                {pending ? t("saving") : t("saveChanges")}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={pending} onClick={() => onSave(false)}>
                {t("savePending")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t("saving") : t(`savePlaced.${placedStatus(draft.kind)}`)}
              </Button>
            </>
          )}
        </div>
        <div className="basis-full empty:hidden">
          <FormError namespace="purchasing.errors" error={error} />
        </div>
      </div>
    </form>
  );
}
