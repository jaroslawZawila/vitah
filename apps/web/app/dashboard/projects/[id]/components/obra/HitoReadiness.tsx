"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Hito } from "@repo/core/contract";
import { useObraFormat } from "./format";
import { cardVariants } from "@/components/ui/card";
import { cardHead, checkLabel, checkRow, codeChip, muted, textLink } from "./classes";
import ProgressBar from "./ProgressBar";

/** Presentational: how ready a hito is for its acta — its chapters and checks. */
export default function HitoReadiness({ hito, href }: { hito: Hito; href: string }) {
  const t = useTranslations("obra.chapter");
  const f = useObraFormat();

  return (
    <section className={cardVariants()}>
      <div className={cardHead}>
        <Link href={href} className={textLink}>
          {t("hitoCard", { code: hito.code, name: hito.name })}
        </Link>
        <span className="text-[13px] font-semibold text-good">{t("hitoReady", { pct: hito.readyPct })}</span>
      </div>
      <div className="flex flex-col gap-2">
        {hito.chapters.map((chapter) => (
          <div key={chapter.code} className="grid grid-cols-[auto_minmax(0,1fr)_44px] items-center gap-2.5 text-[12.5px]">
            <span className={codeChip}>{chapter.code}</span>
            <ProgressBar pct={chapter.progressPct} />
            <span className="num text-right">{chapter.progressPct} %</span>
          </div>
        ))}
      </div>
      {hito.checks.length > 0 && (
        <div>
          {hito.checks.map((check) => (
            <div key={check.id} className={checkRow}>
              <label className={checkLabel}>
                <input type="checkbox" className="size-[18px] accent-good" checked={check.done} readOnly disabled />
                {check.label}
              </label>
            </div>
          ))}
        </div>
      )}
      <span className={muted}>
        {t("billedWhen", { moment: hito.billingMoment, amount: f.money(hito.amountCents) })}
      </span>
    </section>
  );
}
