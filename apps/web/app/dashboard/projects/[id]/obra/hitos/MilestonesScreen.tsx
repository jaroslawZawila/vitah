"use client";

// Container for Obra › Hitos: read-only (invoices and payments are recorded
// on the Pagos tab). The views in ../../components/construction take props only.

import { useTranslations } from "next-intl";
import type { ConstructionControl } from "@repo/core/contract";
import { InvoiceRequests, MilestoneSteps, MilestoneTable } from "../../components/construction/MilestoneViews";
import ObraFrame, { type ObraHeader } from "../../components/construction/ObraFrame";
import { Source, SourceLabel } from "../../components/construction/pills";

/** Each hito is reached when all its chapters are finished; here it is only followed. */
export default function MilestonesScreen({
  projectId,
  header,
  control,
}: {
  projectId: string;
  header: ObraHeader;
  control: ConstructionControl;
}) {
  const t = useTranslations("construction.milestones");
  const ts = useTranslations("construction.sources");

  return (
    <ObraFrame
      projectId={projectId}
      header={header}
      current="milestones"
      title={t("title")}
      description={t("description")}
      aside={
        <div className="flex flex-col gap-1">
          <SourceLabel>
            {t("amountsFrom")} <Source name={ts("budget")} />
          </SourceLabel>
          <SourceLabel>
            {t("invoicesFrom")} <Source name={ts("sales")} />
          </SourceLabel>
        </div>
      }
    >
      <MilestoneSteps />
      <MilestoneTable
        milestones={control.milestones}
        invoiceHref={(m) => `/dashboard/projects/${projectId}/payments/${m.id}`}
      />
      <InvoiceRequests milestones={control.milestones} />
    </ObraFrame>
  );
}
