"use client";

import type { ComponentType } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export type ReviewSection<D, O> = {
  id: string;
  title: string;
  Summary: ComponentType<{ draft: D; options: O }>;
};

/** Presentational: every step's summary, each with an "Edit" link back to it. */
export default function ReviewStep<D, O>({
  sections,
  draft,
  options,
  onEdit,
  intro,
}: {
  sections: ReviewSection<D, O>[];
  /** The line above the summaries; the new-project one by default. */
  intro?: string;
  draft: D;
  options: O;
  onEdit: (index: number) => void;
}) {
  const t = useTranslations("wizard");

  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-[13px] text-muted-foreground">{intro ?? t("reviewIntro")}</p>
      {sections.map(({ id, title, Summary }, index) => (
        <section
          key={id}
          className="flex flex-col gap-2.5 border-t pt-3.5"
          aria-labelledby={`review-${id}`}
        >
          <div className="flex items-center justify-between gap-2">
            <h3 id={`review-${id}`}>{title}</h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-primary hover:text-primary"
              onClick={() => onEdit(index)}
              aria-label={t("editSection", { section: title })}
            >
              {t("edit")}
            </Button>
          </div>
          <Summary draft={draft} options={options} />
        </section>
      ))}
    </div>
  );
}
