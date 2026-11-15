"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { promoterName, type BudgetApproval, type BudgetRevision } from "@repo/core/contract";
import { ofBp, todayInSpain } from "@repo/core/obra-calc";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FormError from "../../../../components/FormError";
import { muted } from "../obra/classes";
import { useObraFormat } from "../obra/format";
import OptionPicker, { toggled } from "./OptionPicker";

export type AcceptInput = { acceptedOn: string; acceptedBy: string; chosenOptionIds: string[]; signed: File | null };

/**
 * Presentational: recording the client's acceptance (shown in a modal): the
 * date (between the day it was issued and today, as core checks), who, the
 * options they chose (the contract price follows live) and, optionally, the
 * signed budget. When the client approved the revision in the app, the date
 * and options start from their approval, which core files as proof beside the
 * signed copy as long as the options are the ones approved.
 */
export default function AcceptDialog({
  revision,
  approval,
  firstHitoBp,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  revision: BudgetRevision;
  /** The client's approval in the app, if they gave one. */
  approval?: BudgetApproval | null;
  /** H0's share, to show what the client pays first. */
  firstHitoBp: number;
  pending: boolean;
  error?: string;
  onSubmit: (input: AcceptInput) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("budget.accept");
  const f = useObraFormat();
  const id = useId();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(approval?.chosenOptionIds));
  const [signed, setSigned] = useState<File | null>(null);
  const today = todayInSpain();
  const { issuedOn } = revision;
  const delta = revision.options.filter((o) => chosen.has(o.id)).reduce((sum, o) => sum + o.priceCents, 0);
  const contract = revision.totalCents + delta;
  const asApproved = !!approval && approval.chosenOptionIds.length === chosen.size && approval.chosenOptionIds.every((o) => chosen.has(o));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSubmit({
          acceptedOn: String(data.get("acceptedOn")),
          acceptedBy: String(data.get("acceptedBy") ?? "").trim(),
          chosenOptionIds: [...chosen],
          signed,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <Label htmlFor={`${id}-on`}>{t("acceptedOn")}</Label>
          <Input
            id={`${id}-on`}
            name="acceptedOn"
            type="date"
            required
            defaultValue={approval?.decidedOn ?? today}
            min={issuedOn ?? undefined}
            max={today}
            aria-describedby={issuedOn ? `${id}-on-hint` : undefined}
          />
          {issuedOn && <FieldDescription id={`${id}-on-hint`}>{t("acceptedOnHint", { issued: f.date(issuedOn) })}</FieldDescription>}
        </Field>
        <Field>
          <Label htmlFor={`${id}-by`}>{t("acceptedBy")}</Label>
          <Input id={`${id}-by`} name="acceptedBy" defaultValue={promoterName(revision.texts.cover.promoter)} />
        </Field>
      </div>

      {revision.options.length > 0 && (
        <OptionPicker legend={t("options")} options={revision.options} chosen={chosen} onToggle={(optionId) => setChosen((c) => toggled(c, optionId))} />
      )}

      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-[11px] bg-raise px-3.5 py-3 text-sm">
        <dt className="text-muted-foreground">{t("pec", { number: revision.number })}</dt>
        <dd className="num">{f.money(revision.totalCents)}</dd>
        <dt className="text-muted-foreground">{t("chosenOptions")}</dt>
        <dd className="num">{f.signedMoney(delta)}</dd>
        <dt className="border-t pt-1.5 font-bold">{t("contract")}</dt>
        <dd className="num border-t pt-1.5 font-bold">{f.money(contract)}</dd>
        <dt className="text-muted-foreground">{t("withVat", { rate: f.share(revision.vatRateBp) })}</dt>
        <dd className="num text-muted-foreground">{f.money(contract + ofBp(contract, revision.vatRateBp))}</dd>
      </dl>

      {approval?.decidedAt && (
        <p className="rounded-[10px] bg-good-soft px-3.5 py-3 text-sm">
          <b>{t("approvalProof", { by: approval.decidedBy ?? "—", date: f.dateTime(approval.decidedAt) })}</b>{" "}
          <span className={muted}>{asApproved ? t("approvalProofHint") : t("approvalDiffers")}</span>
        </p>
      )}

      <Field>
        <Label htmlFor={`${id}-signed`}>
          {t("signed")} <span className="font-normal text-muted-foreground">{t("signedHint")}</span>
        </Label>
        <Input id={`${id}-signed`} type="file" accept="application/pdf" onChange={(event) => setSigned(event.target.files?.[0] ?? null)} />
      </Field>

      <p className="rounded-[10px] bg-brand-soft px-3.5 py-3 text-sm">
        <b>{t("effect", { number: revision.number })}</b>{" "}
        <span className={muted}>{t("effectHint", { first: f.money(ofBp(contract, firstHitoBp)) })}</span>
      </p>
      <FormError namespace="obra.errors" error={error} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>{t("cancel")}</Button>
        <Button type="submit" disabled={pending}>{pending ? t("accepting") : t("submit")}</Button>
      </FormActions>
    </form>
  );
}
