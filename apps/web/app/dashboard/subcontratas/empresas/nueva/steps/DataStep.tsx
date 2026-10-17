"use client";

import { useTranslations } from "next-intl";
import { provinceForPostalCode } from "@repo/core/contract";
import SummaryList from "../../../../components/wizard/SummaryList";
import CompanyDataFields from "../../../components/fields/CompanyDataFields";
import type { CompanyFlowDraft, CompanyStepProps } from "../draft";

/** Step 1: who the company is. */
export function DataStep({ draft, onChange }: CompanyStepProps) {
  return <CompanyDataFields draft={draft} onChange={onChange} />;
}

export function DataSummary({ draft }: { draft: CompanyFlowDraft }) {
  const t = useTranslations("subcontractors.fields");
  const tr = useTranslations("subcontractors");
  const selfEmployed = draft.kind === "self_employed";
  const place = provinceForPostalCode(draft.postalCode.trim());
  return (
    <SummaryList
      items={[
        { label: t("kind"), value: tr(`kinds.${draft.kind}`) },
        { label: selfEmployed ? t("fullName") : t("legalName"), value: draft.legalName },
        { label: selfEmployed ? t("nif") : t("cif"), value: draft.taxId.toUpperCase() },
        {
          label: t("address"),
          value: [draft.address, [draft.postalCode, draft.city].filter(Boolean).join(" "), draft.province]
            .filter(Boolean)
            .join(", "),
        },
        { label: t("reaRegion"), value: place ? tr(`regions.${place.region}`) : null },
        { label: t("phone"), value: draft.phone },
        { label: t("email"), value: draft.email },
        { label: t("legalRep"), value: draft.legalRep },
        { label: t("siteContact"), value: [draft.siteContact, draft.siteContactPhone].filter(Boolean).join(" · ") },
      ]}
    />
  );
}
