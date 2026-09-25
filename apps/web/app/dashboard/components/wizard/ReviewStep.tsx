"use client";

import type { ComponentType } from "react";
import { useTranslations } from "next-intl";
import styles from "./wizard.module.css";

export type ReviewSection<D> = {
  id: string;
  title: string;
  Summary: ComponentType<{ draft: D }>;
};

/** Presentational: every step's summary, each with an "Edit" link back to it. */
export default function ReviewStep<D>({
  sections,
  draft,
  onEdit,
}: {
  sections: ReviewSection<D>[];
  draft: D;
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
          <Summary draft={draft} />
        </section>
      ))}
    </div>
  );
}
