"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Paging } from "@repo/core/contract";
import { buttonVariants } from "@/components/ui/button";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A paged list's foot: which rows of how many are shown, and links to the
 * pages before and after (`hrefOf` gives a page's URL). Nothing when the list
 * fits in one page.
 */
export function Pager({ paging, hrefOf, className }: { paging: Paging; hrefOf: (page: number) => string; className?: string }) {
  const t = useTranslations("pager");
  const format = useFormat();
  const { page, limit, total, pages } = paging;
  if (total === 0 || (pages === 1 && page === 1)) return null;
  const past = page > pages;
  const step = (target: number, label: string, enabled: boolean, rel: "prev" | "next") =>
    enabled ? (
      <Link href={hrefOf(target)} rel={rel} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>
        {label}
      </Link>
    ) : (
      <span aria-disabled="true" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>
        {label}
      </span>
    );
  return (
    <nav aria-label={t("label")} className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-[18px] py-3 text-meta", className)}>
      <span className="num text-muted-foreground">
        {past
          ? t("none", { total: format.number(total) })
          : t("showing", {
              from: format.number((page - 1) * limit + 1),
              to: format.number(Math.min(total, page * limit)),
              total: format.number(total),
            })}
      </span>
      <span className="flex items-center gap-2.5">
        {/* A page past the end goes back to the last one there is. */}
        {step(Math.min(page - 1, pages), t("previous"), page > 1, "prev")}
        <span className="num text-muted-foreground">{t("page", { page, pages })}</span>
        {step(page + 1, t("next"), page < pages, "next")}
      </span>
    </nav>
  );
}
