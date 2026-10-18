"use client";

import Link from "next/link";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BudgetPdfKind } from "@repo/core/contract";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import BackLink from "../../../../components/BackLink";

/**
 * Presentational: a revision's PDF in the browser's viewer, with the
 * general/detailed switch and a download. Drafts are rendered on the fly,
 * marked "BORRADOR"; an issued revision shows what was sent.
 */
export default function BudgetPdfScreen({
  backHref,
  hrefs,
  fileUrl,
  kind,
  draft,
}: {
  backHref: string;
  /** This page for each kind of PDF. */
  hrefs: Record<BudgetPdfKind, string>;
  fileUrl: string;
  kind: BudgetPdfKind;
  draft: boolean;
}) {
  const t = useTranslations("budget.pdf");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-rail px-4 py-2.5 text-rail-foreground">
        <BackLink href={backHref} className="text-sm font-semibold text-rail-foreground hover:text-rail-foreground hover:underline">
          {t("back")}
        </BackLink>
        <div className="inline-flex rounded-[10px] bg-white/10 p-0.5" role="tablist" aria-label={t("kind")}>
          {(["general", "detailed"] as const).map((key) => (
            <Link
              key={key}
              href={hrefs[key]}
              role="tab"
              aria-selected={key === kind}
              className={cn("inline-flex min-h-9 items-center rounded-lg px-3.5 text-[13.5px] font-semibold text-rail-muted", key === kind && "bg-rail-foreground text-rail")}
            >
              {t(key)}
            </Link>
          ))}
        </div>
        <span className="flex flex-wrap items-center gap-2.5">
          <span className="text-[12.5px] text-rail-muted">{t(draft ? "draftHint" : "issuedHint")}</span>
          <a href={fileUrl} download className={buttonVariants({ size: "sm" })}>
            <Download aria-hidden />
            {t("download")}
          </a>
        </span>
      </div>
      <iframe title={t(kind)} src={fileUrl} className="h-[calc(100vh-220px)] min-h-[600px] w-full rounded-[14px] border bg-white" />
    </div>
  );
}
