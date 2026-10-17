"use client";

import { useTranslations } from "next-intl";
import type { WorkerListItem } from "@repo/core/contract";
import Kpi from "../../../projects/[id]/components/obra/Kpi";

/** Presentational: the Trabajadores KPI tiles. */
export default function WorkersKpis({ workers }: { workers: WorkerListItem[] }) {
  const t = useTranslations("subcontractors.workers.kpis");
  const count = (status: string) => workers.filter((w) => w.access.status === status).length;
  const companies = new Set(workers.map((w) => w.subcontractorId)).size;
  const tiles = [
    { key: "registered", value: workers.length, detail: t("registeredDetail", { count: companies }), tone: "" },
    { key: "ok", value: count("ok"), detail: t("okDetail"), tone: "text-good" },
    { key: "pending", value: count("pending"), detail: t("pendingDetail"), tone: "text-yel" },
    { key: "blocked", value: count("blocked"), detail: t("blockedDetail"), tone: "text-bad" },
    {
      key: "preventive",
      value: workers.filter((w) => w.roles.includes("preventive_resource")).length,
      detail: t("preventiveDetail"),
      tone: "",
    },
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
