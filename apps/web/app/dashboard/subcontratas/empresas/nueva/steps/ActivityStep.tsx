"use client";

import { useTranslations } from "next-intl";
import SummaryList from "../../../../components/wizard/SummaryList";
import ActivityFields from "../../../components/fields/ActivityFields";
import type { CompanyFlowDraft, CompanyStepProps } from "../draft";

/** Step 2: trades, workforce, subcontracting and prevention. */
export function ActivityStep({ draft, onChange }: CompanyStepProps) {
  return <ActivityFields draft={draft} onChange={onChange} />;
}

export function ActivitySummary({ draft }: { draft: CompanyFlowDraft }) {
  const t = useTranslations("subcontractors.fields");
  const tr = useTranslations("subcontractors");
  const list = (items: string[], ns: string) => items.map((item) => tr(`${ns}.${item}`)).join(", ");
  return (
    <SummaryList
      items={[
        { label: t("trades"), value: list(draft.trades, "trades") },
        { label: t("installer"), value: draft.isInstaller ? draft.installerReg || t("yes") : t("no") },
        {
          label: t("workforce"),
          value: draft.headcount ? t("workforceSummary", { headcount: draft.headcount, permanent: draft.permanentCount || "0" }) : null,
        },
        { label: t("subcontracts"), value: draft.subcontractsFurther ? t("yes") : t("no") },
        { label: t("chainLevel"), value: t(`chainLevels.${draft.chainLevel}`) },
        {
          label: t("prevention"),
          value: draft.preventionMode
            ? [tr(`preventionModes.${draft.preventionMode}.label`), draft.preventionEntity].filter(Boolean).join(" · ")
            : null,
        },
        { label: t("machinery"), value: list(draft.machinery, "machinery") },
      ]}
    />
  );
}
