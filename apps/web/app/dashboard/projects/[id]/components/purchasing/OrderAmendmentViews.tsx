"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import type { PurchaseForm, PurchaseOrderDetail } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import FormError from "../../../../components/FormError";
import FileSlot from "../../../../subcontratas/empresas/nueva/steps/FileSlot";
import { deviationTone } from "../construction/format";
import { orderTotals, type LineDraft, type ParseAmount } from "./draft";
import { day, usePurchaseFormat } from "./format";
import { Lines } from "./OrderForm";
import { EventText } from "./OrderViews";

// Presentational: an order's modificados (the card on its page) and the form
// that records one. The containers (OrderScreen, AmendmentFormScreen) run the
// actions.

/** The original amount, what the modificados changed and each of them, newest first. */
export function OrderAmendments({
  order,
  amendHref,
  documentUrl,
}: {
  order: PurchaseOrderDetail;
  /** "Registrar modificado"; omitted for viewers and orders not placed. */
  amendHref?: string;
  documentUrl: (documentId: string) => string;
}) {
  const t = useTranslations("purchasing.amendments");
  const f = usePurchaseFormat();
  const { amendments } = order;
  const deltaCents = order.amountCents - order.originalAmountCents;
  return (
    <section className={cardVariants()} aria-labelledby="amendments-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="amendments-title" className="text-[22px]">
          {t("title")} <span className="num text-[16px] text-muted-foreground">{amendments.length}</span>
        </h2>
        {amendHref && (
          <Link href={amendHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("add")}
          </Link>
        )}
      </div>
      {amendments.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">{t("none")}</p>
      ) : (
        <>
          <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
            <span className="text-muted-foreground">{t("original")}</span>
            <span className="num">{f.money(order.originalAmountCents)}</span>
            <span className="text-muted-foreground">→ {t("current")}</span>
            <span className="num font-semibold">{f.money(order.amountCents)}</span>
            <span className={cn("num", deviationTone(deltaCents))}>({f.signedMoney(deltaCents)})</span>
          </p>
          <ol className="m-0 flex list-none flex-col p-0" aria-label={t("list")}>
            {amendments.map((amendment) => {
              const delta = amendment.amountAfterCents - amendment.amountBeforeCents;
              return (
                <li key={amendment.id} className="flex flex-col gap-1 border-t py-3 text-[13.5px] first:border-t-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <b>{t("number", { number: amendment.number })}</b>
                    <span className="num text-muted-foreground">{f.shortDay(amendment.signedOn)}</span>
                    <Badge variant="outline" className={cn("num", deviationTone(delta))}>
                      {f.signedMoney(delta)}
                    </Badge>
                  </div>
                  <p className="m-0 [overflow-wrap:anywhere]">{amendment.concept}</p>
                  <p className="m-0 text-[12.5px] text-muted-foreground">
                    <EventText event={{ id: amendment.id, action: "lines", detail: { changes: amendment.changes }, note: null, by: null, at: amendment.at }} />
                  </p>
                  <p className="m-0 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted-foreground">
                    {amendment.document && (
                      <a href={documentUrl(amendment.document.id)} download className="inline-flex items-center gap-1 font-medium text-brand-ink hover:text-primary">
                        <FileText aria-hidden className="size-3.5 flex-none" />
                        {amendment.document.title}
                      </a>
                    )}
                    <span>{t("recorded", { by: amendment.by ?? "—", date: f.shortDay(day(amendment.at)) })}</span>
                  </p>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

/** What the amendment form holds: its reason and day, the order's lines as they will be, and its PDF. */
export type AmendmentDraft = {
  concept: string;
  signedOn: string;
  chapter: string;
  lines: Record<string, LineDraft>;
  file: File | null;
};

/**
 * The form of a modificado: why and when, the order's lines as they end up
 * (changed, added, removed or closing differently) and the signed PDF.
 */
export function AmendmentForm({
  form,
  draft,
  parse,
  number,
  beforeCents,
  pending,
  error,
  onChange,
  onSave,
  cancelHref,
}: {
  form: PurchaseForm;
  draft: AmendmentDraft;
  parse: ParseAmount;
  /** The number it will take. */
  number: number;
  /** The order's amount now. */
  beforeCents: number;
  pending: boolean;
  error?: string | null;
  onChange: (patch: Partial<AmendmentDraft>) => void;
  onSave: () => void;
  cancelHref: string;
}) {
  const t = useTranslations("purchasing.amendments.form");
  const f = usePurchaseFormat();
  const [touched, setTouched] = useState(false);
  const afterCents = orderTotals(form, draft, parse).totalCents;
  const delta = afterCents - beforeCents;
  return (
    <form
      noValidate
      aria-label={t("label", { number })}
      className="flex flex-col gap-[18px]"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        onSave();
      }}
    >
      <section className={cn(cardVariants(), "gap-3.5")} aria-labelledby="amendment-why">
        <h2 id="amendment-why" className="text-[22px]">
          {t("whyTitle")}
        </h2>
        <Field>
          <Label htmlFor="amendment-concept">{t("concept")}</Label>
          <Input
            id="amendment-concept"
            required
            maxLength={500}
            value={draft.concept}
            placeholder={t("conceptPlaceholder")}
            aria-invalid={touched && !draft.concept.trim()}
            onChange={(e) => onChange({ concept: e.target.value })}
          />
        </Field>
        <Field className="sm:max-w-[260px]">
          <Label htmlFor="amendment-signed-on">{t("signedOn")}</Label>
          <Input id="amendment-signed-on" type="date" value={draft.signedOn} max={form.today} onChange={(e) => onChange({ signedOn: e.target.value })} />
          <FieldDescription>{t("signedOnHint")}</FieldDescription>
        </Field>
      </section>

      <Lines form={form} draft={draft} parse={parse} onChange={onChange} title={t("linesTitle")} />

      <section className={cn(cardVariants(), "gap-3")} aria-labelledby="amendment-document">
        <h2 id="amendment-document" className="text-[22px]">
          {t("documentTitle")} <span className="font-sans text-[13px] font-normal tracking-normal text-muted-foreground">{t("optional")}</span>
        </h2>
        <p className="m-0 text-[13px] text-muted-foreground">{t("documentHint", { number })}</p>
        <FileSlot
          id="amendment-file"
          label={t("chooseFile")}
          file={draft.file}
          onChange={(file) => onChange({ file })}
          namespace="purchasing.amendments.form"
          errorNamespace="purchasing.errors"
        />
      </section>

      <div
        role="region"
        aria-label={t("totalLabel")}
        className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-card px-[18px] py-3.5 shadow-card"
      >
        <div>
          <div className="eyebrow">{t("before")}</div>
          <div className="num text-base">{f.money(beforeCents)}</div>
        </div>
        <div>
          <div className="eyebrow">{t("after")}</div>
          <div className="num text-[22px] font-semibold">{f.money(afterCents)}</div>
        </div>
        <div>
          <div className="eyebrow">{t("delta")}</div>
          <div className={cn("num text-base font-semibold", deviationTone(delta))}>{f.signedMoney(delta)}</div>
        </div>
        <div className="flex w-full flex-col-reverse gap-2 sm:ml-auto sm:w-auto sm:flex-row">
          <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
            {t("cancel")}
          </Link>
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("save", { number })}
          </Button>
        </div>
        <div className="basis-full empty:hidden">
          <FormError namespace="purchasing.errors" error={error} />
        </div>
      </div>
    </form>
  );
}
