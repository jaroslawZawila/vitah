"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { BudgetRevision } from "@repo/core/contract";
import { addDays, todayInSpain } from "@repo/core/obra-calc";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import FormError from "../../../../components/FormError";
import { muted } from "../obra/classes";
import { useObraFormat } from "../obra/format";

export type IssueInput = { issuedOn: string; validUntil: string; changeReason?: string; shareWithClient: boolean };

/**
 * Presentational: issuing a draft to the client (shown in a modal): dates,
 * the reason for the change (Rev.1 on), the PDFs and who sees them.
 */
export default function IssueDialog({
  revision,
  clientName,
  reviewHref,
  pdfHref,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  revision: BudgetRevision;
  clientName: string | null;
  reviewHref: string;
  pdfHref: (kind: "general" | "detailed") => string;
  pending: boolean;
  error?: string;
  onSubmit: (input: IssueInput) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("budget.issue");
  const f = useObraFormat();
  const id = useId();
  const [issuedOn, setIssuedOn] = useState(todayInSpain);
  const [validUntil, setValidUntil] = useState(() => addDays(todayInSpain(), revision.conditions.validityDays));
  const [share, setShare] = useState(true);
  const open = revision.checks.filter((c) => !c.done).length;
  const lines = revision.lineCount;
  const first = revision.number === 0;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const reason = String(new FormData(event.currentTarget).get("changeReason") ?? "").trim();
        onSubmit({ issuedOn, validUntil, shareWithClient: share, ...(first ? {} : { changeReason: reason }) });
      }}
    >
      {/* Two amounts side by side; the contents, longer, get their own row. */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        {[
          [t("pec"), f.money(revision.totalCents)],
          [t("withVat"), f.money(revision.totalCents + revision.vatCents)],
          [t("contents"), t("contentsValue", { lines, options: revision.options.length })],
        ].map(([label, value], i) => (
          <div key={label} className={cn("min-w-0 rounded-[10px] bg-raise px-3 py-2.5", i === 2 && "sm:col-span-2")}>
            <span className="eyebrow">{label}</span>
            <div className="num text-[15px] font-semibold whitespace-normal">{value}</div>
          </div>
        ))}
      </div>

      {open > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-[11px] border border-warn/40 bg-warn-soft px-3.5 py-3 text-sm">
          <span className="min-w-[220px] flex-1">
            <b>{t("openChecks", { count: open })}</b> <span className="text-muted-foreground">{t("openChecksHint")}</span>
          </span>
          <Link href={reviewHref} className={buttonVariants({ variant: "outline", size: "sm" })} onClick={onCancel}>
            {t("review")}
          </Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <Label htmlFor={`${id}-issued`}>{t("issuedOn")}</Label>
          <Input id={`${id}-issued`} type="date" required value={issuedOn} onChange={(event) => {
            setIssuedOn(event.target.value);
            setValidUntil(addDays(event.target.value, revision.conditions.validityDays));
          }} />
        </Field>
        <Field>
          <Label htmlFor={`${id}-valid`}>{t("validUntil")}</Label>
          <Input id={`${id}-valid`} type="date" required value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
          <FieldDescription>{t("validHint", { days: revision.conditions.validityDays })}</FieldDescription>
        </Field>
      </div>

      <Field>
        <Label htmlFor={`${id}-reason`}>{t("reason")}</Label>
        {first ? (
          <Input id={`${id}-reason`} value={t("firstIssue")} disabled />
        ) : (
          <Textarea id={`${id}-reason`} name="changeReason" rows={3} required defaultValue={revision.changeReason ?? ""} />
        )}
        <FieldDescription>{t("reasonHint")}</FieldDescription>
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">{t("pdfs")}</span>
        {(["general", "detailed"] as const).map((kind) => (
          <div key={kind} className="flex flex-wrap items-center gap-3 rounded-[11px] border px-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <b>{t(`${kind}.title`)}</b> <span className="text-muted-foreground">· {t(`${kind}.hint`)}</span>
            </span>
            <Badge variant={kind === "general" && share ? "good" : "outline"}>{t(kind === "general" && share ? "inApp" : "staffOnly")}</Badge>
            <Link href={pdfHref(kind)} target="_blank" className="text-[13px] font-semibold text-brand-ink hover:underline">
              {t("preview")}
            </Link>
          </div>
        ))}
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-[11px] border border-primary/30 bg-brand-soft px-3.5 py-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-[18px] accent-primary" checked={share} onChange={(event) => setShare(event.target.checked)} />
        <span>
          <b>{t("share")}</b>
          <span className={`${muted} block`}>{clientName ? t("shareHint", { name: clientName }) : t("shareNoClient")}</span>
        </span>
      </label>

      <p className={`${muted} rounded-[10px] bg-raise px-3 py-2.5`}>{t("freezeNote", { number: revision.number, next: revision.number + 1 })}</p>
      <FormError namespace="obra.errors" error={error} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>{t("cancel")}</Button>
        <Button type="submit" disabled={pending}>{pending ? t("issuing") : t("submit", { number: revision.number })}</Button>
      </FormActions>
    </form>
  );
}
