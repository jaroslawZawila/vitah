"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BudgetRevisionSummary } from "@repo/core/contract";
import { cn } from "@/lib/utils";
import { useObraFormat } from "../obra/format";
import Popover from "./Popover";
import RevisionPill, { useRevisionDates } from "./RevisionPill";

/**
 * Presentational: the revision shown, as a pill beside the title that opens
 * every revision, newest first. Below `sm` the menu is anchored to the nearest
 * positioned ancestor (the title row), so on a phone it spans the row.
 */
export default function RevisionMenu({
  revision,
  revisions,
  hrefOf,
}: {
  revision: BudgetRevisionSummary;
  /** Newest first. */
  revisions: BudgetRevisionSummary[];
  hrefOf: (revisionId: string) => string;
}) {
  const t = useTranslations("budget");
  const f = useObraFormat();
  const [open, setOpen] = useState(false);
  const dates = useRevisionDates();
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className="sm:relative">
      <RevisionPill
        number={revision.number}
        status={revision.status}
        render={<button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)} />}
        className="min-h-8 cursor-pointer pr-2.5 pl-3 text-[13px] hover:brightness-95 pointer-coarse:min-h-11"
      >
        <ChevronDown aria-hidden className={cn("transition-transform", open && "rotate-180")} />
      </RevisionPill>
      {/* Below `sm` it spans the title row; from `sm` it hangs from the pill. */}
      <Popover open={open} onClose={close} label={t("revisionMenu.title")} className="left-0 w-auto p-1.5 sm:right-auto sm:w-[340px]">
        <span className="eyebrow px-2.5 pt-2 pb-1.5">{t("revisionMenu.title")}</span>
        <ul>
          {revisions.map((r) => {
            const current = r.id === revision.id;
            return (
              <li key={r.id}>
                <Link
                  href={hrefOf(r.id)}
                  onClick={close}
                  aria-current={current ? "page" : undefined}
                  className={cn("flex min-h-13 items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-raise", current && "bg-brand-soft hover:bg-brand-soft")}
                >
                  <Check aria-hidden className={cn("size-4 flex-none text-brand-ink", !current && "invisible")} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <RevisionPill number={r.number} status={r.status} />
                    <span className="text-xs text-muted-foreground">{dates(r)}</span>
                  </span>
                  <span className="num text-[12.5px] whitespace-nowrap">{f.money(r.totalCents)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Popover>
    </div>
  );
}
