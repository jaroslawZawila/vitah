"use client";

import { useTranslations } from "next-intl";
import { GitCompareArrows } from "lucide-react";
import type { ControlChapter, ObraError, RemovedChapter } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import FormError from "../../../../components/FormError";
import { useControlFormat } from "./format";

/**
 * Presentational: the accepted revision added or removed chapters; staff
 * review them (removed ones keep what was recorded on them).
 */
export default function ReviewBanner({
  added,
  removed,
  onReviewed,
  pending,
  error,
}: {
  added: ControlChapter[];
  removed: RemovedChapter[];
  /** Omitted for viewers. */
  onReviewed?: () => void;
  pending: boolean;
  error?: ObraError;
}) {
  const t = useTranslations("construction.review");
  const f = useControlFormat();

  return (
    <section
      aria-labelledby="review-title"
      className="flex flex-col gap-2.5 rounded-xl border border-info/30 bg-info-soft px-4 py-3.5 text-[13.5px]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <GitCompareArrows aria-hidden className="mt-0.5 size-4 flex-none text-info" />
          <div className="min-w-0">
            <h2 id="review-title" className="font-sans text-[14.5px] font-semibold tracking-normal">
              {t("title")}
            </h2>
            <p className="text-muted-foreground">{t("text")}</p>
          </div>
        </div>
        {onReviewed && (
          <Button type="button" variant="outline" onClick={onReviewed} disabled={pending}>
            {pending ? t("saving") : t("markReviewed")}
          </Button>
        )}
      </div>
      {added.length > 0 && (
        <p>
          <b>{t("added")}</b> {added.map((c) => `${c.code} ${c.name}`).join(" · ")}
        </p>
      )}
      {removed.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={t("removed")}>
          <li>
            <b>{t("removed")}</b>
          </li>
          {removed.map((c) => (
            <li key={c.code}>
              <span className="num">{c.code}</span> {c.name ?? ""}
              <span className="text-muted-foreground">
                {" · "}
                {c.actualStart
                  ? t("recorded", {
                      start: f.day(c.actualStart),
                      end: c.actualEnd ? f.day(c.actualEnd) : "…",
                    })
                  : t("nothingRecorded")}
              </span>
            </li>
          ))}
        </ul>
      )}
      <FormError namespace="obra.errors" error={error} />
    </section>
  );
}
