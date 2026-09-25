"use client";

import { useFormatter, useTranslations } from "next-intl";
import { fieldStyles as f } from "../../../components/wizard/fields";
import SummaryList from "../../../components/wizard/SummaryList";
import type { ProjectDraft, ProjectStepProps } from "../draft";

/** Step: the basics the mobile app shows — reference, address and dates. */
export function DetailsStep({ draft, onChange }: ProjectStepProps) {
  const t = useTranslations("newProjectPage.details");

  return (
    <div className={f.fields}>
      <div className={f.field}>
        <label htmlFor="project-ref">{t("ref")}</label>
        <input
          id="project-ref"
          required
          autoFocus
          placeholder={t("refPlaceholder")}
          value={draft.ref}
          onChange={(e) => onChange({ ref: e.target.value })}
        />
      </div>
      <div className={`${f.field} ${f.wide}`}>
        <label htmlFor="project-address">{t("address")}</label>
        <input
          id="project-address"
          required
          placeholder={t("addressPlaceholder")}
          value={draft.address}
          onChange={(e) => onChange({ address: e.target.value })}
        />
      </div>
      <div className={f.field}>
        <label htmlFor="project-start">{t("startDate")}</label>
        <input
          id="project-start"
          type="date"
          value={draft.startDate}
          onChange={(e) => onChange({ startDate: e.target.value })}
        />
      </div>
      <div className={f.field}>
        <label htmlFor="project-completion">{t("completionDate")}</label>
        <input
          id="project-completion"
          type="date"
          min={draft.startDate || undefined}
          value={draft.completionDate}
          onChange={(e) => onChange({ completionDate: e.target.value })}
        />
      </div>
    </div>
  );
}

export function DetailsSummary({ draft }: { draft: ProjectDraft }) {
  const t = useTranslations("newProjectPage.details");
  const format = useFormatter();
  const date = (value: string) =>
    value
      ? format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: "long", timeZone: "UTC" })
      : null;

  return (
    <SummaryList
      items={[
        { label: t("ref"), value: draft.ref },
        { label: t("address"), value: draft.address },
        { label: t("startDate"), value: date(draft.startDate) },
        { label: t("completionDate"), value: date(draft.completionDate) },
      ]}
    />
  );
}
