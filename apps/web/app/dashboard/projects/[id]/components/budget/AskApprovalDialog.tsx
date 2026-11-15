"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { AskApprovalInput, BudgetRevision } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FormActions } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import FormError from "../../../../components/FormError";
import { muted } from "../obra/classes";
import { useObraFormat } from "../obra/format";
import OptionPicker, { toggled } from "./OptionPicker";

/**
 * Presentational: asking the project's client to approve the issued revision
 * in the app (shown in a modal): a short message and the options proposed as
 * chosen, with the contract price they give (without VAT).
 */
export default function AskApprovalDialog({
  revision,
  clientName,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  revision: BudgetRevision;
  clientName: string | null;
  pending: boolean;
  error?: string;
  onSubmit: (input: AskApprovalInput) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("budget.approval.dialog");
  const f = useObraFormat();
  const id = useId();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const contract = revision.totalCents + revision.options.filter((o) => chosen.has(o.id)).reduce((sum, o) => sum + o.priceCents, 0);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const message = String(new FormData(event.currentTarget).get("message") ?? "");
        onSubmit({ message, chosenOptionIds: [...chosen] });
      }}
    >
      <p className="text-sm">{t("intro", { client: clientName ?? "—" })}</p>
      <Field>
        <Label htmlFor={`${id}-message`}>
          {t("message")} <span className="font-normal text-muted-foreground">{t("optional")}</span>
        </Label>
        <Textarea id={`${id}-message`} name="message" maxLength={1000} placeholder={t("messagePlaceholder")} aria-describedby={`${id}-message-hint`} />
        <FieldDescription id={`${id}-message-hint`}>{t("messageHint")}</FieldDescription>
      </Field>
      {revision.options.length > 0 && (
        <OptionPicker legend={t("options")} options={revision.options} chosen={chosen} onToggle={(optionId) => setChosen((c) => toggled(c, optionId))} />
      )}
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-[11px] bg-raise px-3.5 py-3 text-sm">
        <dt className="font-bold">{t("contract", { number: revision.number })}</dt>
        <dd className="num font-bold">{f.money(contract)}</dd>
      </dl>
      <p className={muted}>{t("shows")}</p>
      <FormError namespace="obra.errors" error={error} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>{t("cancel")}</Button>
        <Button type="submit" disabled={pending}>{pending ? t("sending") : t("submit")}</Button>
      </FormActions>
    </form>
  );
}
