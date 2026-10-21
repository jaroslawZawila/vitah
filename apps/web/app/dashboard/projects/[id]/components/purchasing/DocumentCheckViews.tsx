"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import type { DocumentFinding, PurchaseDocumentCheck } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import FormError from "../../../../components/FormError";
import { Dot } from "../construction/pills";
import { day, usePurchaseFormat } from "./format";

// Presentational: the AI's review of an order's or an invoice's PDFs. It
// only warns; staff mark warnings as seen or ask again. The containers
// (OrderScreen, InvoiceScreen) run the actions and refresh while it runs.

/** Whether a review is still under way (the page re-reads until it ends). */
export const reviewing = (checks: PurchaseDocumentCheck[]) => checks.some((c) => c.status === "pending" || c.status === "running");

function CheckState({ check }: { check: PurchaseDocumentCheck }) {
  const t = useTranslations("purchasing.checks.status");
  if (check.status === "pending" || check.status === "running") return <Badge variant="info"><Dot />{t("reviewing")}</Badge>;
  if (check.status === "skipped") return <Badge variant="outline">{t("skipped")}</Badge>;
  const warnings = check.findings.length;
  if (check.status === "failed" && warnings === 0) return <Badge variant="outline">{t("failed")}</Badge>;
  if (warnings === 0) return <Badge variant="good"><Dot />{t("clear")}</Badge>;
  return (
    <Badge variant={check.dismissedAt ? "outline" : "warn"}>
      <Dot />
      {t("warnings", { count: warnings })}
    </Badge>
  );
}

function Finding({ finding, duplicateHref }: { finding: DocumentFinding; duplicateHref: (finding: DocumentFinding) => string }) {
  const t = useTranslations("purchasing.checks.kinds");
  const locale = useLocale();
  return (
    <li className="flex flex-col gap-0.5">
      <b className="text-[13px]">{t(finding.kind)}</b>
      {finding.duplicate ? (
        <span className="text-[12.5px] text-muted-foreground">
          {t("duplicateOf")}{" "}
          <Link href={duplicateHref(finding)} className="font-medium text-brand-ink hover:text-primary">
            {finding.duplicate.label}
          </Link>
        </span>
      ) : (
        finding.detail && <span className="text-[12.5px] text-muted-foreground">{locale === "en" ? finding.detail.en : finding.detail.es}</span>
      )}
    </li>
  );
}

/** The reviews of the page's PDFs, newest first: what the AI saw, and what to do about it. */
export function DocumentChecks({
  checks,
  canManage,
  pending,
  error,
  duplicateHref,
  onRecheck,
  onDismiss,
}: {
  checks: PurchaseDocumentCheck[];
  canManage: boolean;
  pending: boolean;
  error?: string;
  /** Where the other copy of a duplicate is. */
  duplicateHref: (finding: DocumentFinding) => string;
  onRecheck: (check: PurchaseDocumentCheck) => void;
  onDismiss: (check: PurchaseDocumentCheck) => void;
}) {
  const t = useTranslations("purchasing.checks");
  const f = usePurchaseFormat();
  return (
    <section className={cardVariants()} aria-labelledby="checks-title">
      <div>
        <h2 id="checks-title" className="flex items-center gap-2 text-[22px]">
          <Sparkles aria-hidden className="size-5 text-primary" />
          {t("title")}
        </h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">{t("intro")}</p>
      </div>
      <ul className="m-0 flex list-none flex-col p-0" aria-label={t("title")}>
        {checks.map((check) => {
          const settled = check.status !== "pending" && check.status !== "running";
          const seen = !!check.dismissedAt;
          return (
            <li key={check.id} className="flex flex-col gap-2 border-t py-3 first:border-t-0">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <b className="min-w-0 text-[13.5px] [overflow-wrap:anywhere]">{check.label}</b>
                <span className="text-[12px] text-muted-foreground">{t(`subject.${check.subject}`)}</span>
                <CheckState check={check} />
                {canManage && settled && (
                  <span className="ml-auto flex gap-1">
                    {check.findings.length > 0 && !seen && (
                      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => onDismiss(check)}>
                        {t("dismiss")}
                      </Button>
                    )}
                    <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => onRecheck(check)} aria-label={t("recheckOf", { label: check.label })}>
                      {t("recheck")}
                    </Button>
                  </span>
                )}
              </div>
              {check.findings.length > 0 && (
                <ul className={cn("m-0 flex list-none flex-col gap-1.5 border-l-2 p-0 pl-3", seen ? "border-border opacity-70" : "border-warn")}>
                  {check.findings.map((finding, index) => (
                    <Finding key={index} finding={finding} duplicateHref={duplicateHref} />
                  ))}
                </ul>
              )}
              {(seen || check.checkedAt || check.status === "skipped") && (
                <p className="m-0 text-[12px] text-muted-foreground">
                  {seen
                    ? t("seen", { by: check.dismissedBy ?? "—", date: f.shortDay(day(check.dismissedAt!)) })
                    : check.status === "skipped"
                      ? t("skippedHint")
                      : t("checked", { date: f.shortDay(day(check.checkedAt!)) })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <FormError namespace="purchasing.errors" error={error} />
    </section>
  );
}
