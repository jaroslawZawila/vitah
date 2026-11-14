"use client";

import { useTranslations } from "next-intl";
import type { WorkersPage } from "@repo/core/contract";
import Kpi from "../../../projects/[id]/components/obra/Kpi";

/** Presentational: the Trabajadores KPI tiles, of every worker (of the obra chosen), whatever page is shown. */
export default function WorkersKpis({ summary }: { summary: WorkersPage["summary"] }) {
  const t = useTranslations("subcontractors.workers.kpis");
  const tiles = [
    { key: "registered", value: summary.registered, detail: t("registeredDetail", { count: summary.companies }), tone: "" },
    { key: "ok", value: summary.ok, detail: t("okDetail"), tone: "text-good" },
    { key: "pending", value: summary.pending, detail: t("pendingDetail"), tone: "text-yel" },
    { key: "blocked", value: summary.blocked, detail: t("blockedDetail"), tone: "text-bad" },
    { key: "preventive", value: summary.preventive, detail: t("preventiveDetail"), tone: "" },
  ];
  return (
    <section className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-5" aria-label={t("label")}>
      {tiles.map((tile) => (
        <Kpi
          key={tile.key}
          label={t(tile.key)}
          value={<span className={tile.tone || undefined}>{tile.value}</span>}
          hints={[tile.detail]}
        />
      ))}
    </section>
  );
}
