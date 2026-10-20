"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PurchaseForm } from "@repo/core/contract";
import { Button, buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import FormError from "../../../../components/FormError";
import type { ParseAmount } from "./draft";
import { usePurchaseFormat } from "./format";
import { KindAndSupplier, Lines } from "./OrderForm";
import { requestTotal, type RequestDraft } from "./request-draft";

/**
 * Presentational: the new / edit purchase request form. The obra says what
 * it needs (material or a subcontract, the budget lines with an estimate,
 * by when) and may suggest a supplier; the office orders it once approved.
 */
export default function RequestForm({
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
  /** The order form's choices: suppliers and the contract's lines. */
  form: PurchaseForm;
  draft: RequestDraft;
  parse: ParseAmount;
  onChange: (patch: Partial<RequestDraft>) => void;
  editing: boolean;
  pending: boolean;
  error?: string | null;
  onSave: () => void;
  cancelHref: string;
}) {
  const t = useTranslations("purchasing.requests.form");
  const f = usePurchaseFormat();
  return (
    <form
      noValidate
      aria-label={editing ? t("editLabel") : t("newLabel")}
      className="flex flex-col gap-[18px]"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <KindAndSupplier form={form} draft={draft} onChange={onChange} kindLocked={false} supplierOptional />

      <section className={cn(cardVariants(), "gap-3.5")} aria-labelledby="request-concept">
        <h2 id="request-concept" className="text-[22px]">
          {t("conceptTitle")}
        </h2>
        <Field>
          <Label htmlFor="request-description">{t("description")}</Label>
          <Input
            id="request-description"
            required
            maxLength={500}
            value={draft.description}
            placeholder={t("descriptionPlaceholder")}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </Field>
        <Field className="sm:max-w-[260px]">
          <Label htmlFor="request-needed-by">{t("neededBy")}</Label>
          <Input id="request-needed-by" type="date" value={draft.neededBy} onChange={(e) => onChange({ neededBy: e.target.value })} />
          <FieldDescription>{t("neededByHint")}</FieldDescription>
        </Field>
        <Field>
          <Label htmlFor="request-notes">{t("notes")}</Label>
          <Textarea
            id="request-notes"
            rows={3}
            maxLength={2000}
            value={draft.notes}
            placeholder={t("notesPlaceholder")}
            onChange={(e) => onChange({ notes: e.target.value })}
          />
        </Field>
      </section>

      <Lines form={form} draft={draft} parse={parse} onChange={onChange} estimate />

      <div
        role="region"
        aria-label={t("totalLabel")}
        className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-card px-[18px] py-3.5 shadow-card"
      >
        <div>
          <div className="eyebrow">{t("total")}</div>
          <div className="num text-[22px] font-semibold">{f.money(requestTotal(form, draft, parse))}</div>
        </div>
        <div className="flex w-full flex-col-reverse gap-2 sm:ml-auto sm:w-auto sm:flex-row">
          <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
            {t("cancel")}
          </Link>
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : editing ? t("saveChanges") : t("send")}
          </Button>
        </div>
        <div className="basis-full empty:hidden">
          <FormError namespace="purchasing.requestErrors" error={error} />
        </div>
      </div>
    </form>
  );
}
