"use client";

import type { ComponentType } from "react";
import { useTranslations } from "next-intl";
import styles from "./wizard.module.css";

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
}: {
  sections: ReviewSection<D, O>[];
  draft: D;
  options: O;
  onEdit: (index: number) => void;
}) {
  const t = useTranslations("wizard");

  return (
    <div className={styles.review}>
      <p className={styles.intro}>{t("reviewIntro")}</p>
      {sections.map(({ id, title, Summary }, index) => (
        <section key={id} className={styles.reviewSection} aria-labelledby={`review-${id}`}>
          <div className={styles.reviewHeader}>
            <h3 id={`review-${id}`} className={styles.reviewTitle}>
              {title}
            </h3>
            <button
              type="button"
              className={styles.edit}
              onClick={() => onEdit(index)}
              aria-label={t("editSection", { section: title })}
            >
              {t("edit")}
            </button>
          </div>
          <Summary draft={draft} options={options} />
        </section>
      ))}
    </div>
  );
}
