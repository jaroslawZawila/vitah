"use client";

import { useId, useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { codeRange, promoterName, type BudgetRevision } from "@repo/core/contract";
import { ofBp, todayInSpain } from "@repo/core/obra-calc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import FormError from "../../../../components/FormError";
import { muted } from "../obra/classes";
import { useObraFormat } from "../obra/format";
import { OPTION_VARIANT } from "./OptionSummary";

export type AcceptInput = { acceptedOn: string; acceptedBy: string; chosenOptionIds: string[]; signed: File | null };

/**
 * Presentational: recording the client's acceptance (shown in a modal): the
 * date, who, the options they chose (the contract price follows live) and,
 * optionally, the signed budget.
 */
export default function AcceptDialog({
  revision,
  firstHitoBp,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  revision: BudgetRevision;
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
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [signed, setSigned] = useState<File | null>(null);
  const delta = revision.options.filter((o) => chosen.has(o.id)).reduce((sum, o) => sum + o.totalCents, 0);
  const contract = revision.totalCents + delta;
  const toggle = (optionId: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });

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
          <Input id={`${id}-on`} name="acceptedOn" type="date" required defaultValue={todayInSpain()} />
        </Field>
        <Field>
          <Label htmlFor={`${id}-by`}>{t("acceptedBy")}</Label>
          <Input id={`${id}-by`} name="acceptedBy" defaultValue={promoterName(revision.texts.cover.promoter)} />
        </Field>
      </div>

      {revision.options.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-[13px] font-semibold">{t("options")}</legend>
          {revision.options.map((option) => {
            const on = chosen.has(option.id);
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(option.id)}
                className={cn("grid grid-cols-[22px_auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-left text-sm", on && "border-primary bg-brand-soft")}
              >
                <span className={cn("flex size-[18px] items-center justify-center rounded-[5px] border-[1.5px]", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50")}>
                  {on && <Check size={12} aria-hidden />}
                </span>
                <Badge variant={OPTION_VARIANT[option.optionKind]}>{t(`kinds.${option.optionKind}`)}</Badge>
                <span>
                  <span className="num text-muted-foreground">{codeRange(option.lines)}</span> · {option.name}
                </span>
                <span className="num font-semibold">{f.signedMoney(option.totalCents)}</span>
              </button>
            );
          })}
        </fieldset>
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

      <Field>
        <Label htmlFor={`${id}-signed`}>
          {t("signed")} <span className="font-normal text-muted-foreground">{t("signedHint")}</span>
        </Label>
        <Input id={`${id}-signed`} type="file" accept="application/pdf" onChange={(event) => setSigned(event.target.files?.[0] ?? null)} />
      </Field>

      <p className="rounded-[10px] bg-brand-soft px-3.5 py-3 text-[13.5px]">
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
