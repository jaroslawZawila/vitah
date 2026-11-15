"use client";

// The project's Garantía tab: what the client sent from the app. Staff handle
// each claim on its own page; the list only filters (no actions here).

import { useState } from "react";
import { useTranslations } from "next-intl";
import { OPEN_WARRANTY_STATUSES, type ProjectWarranty } from "@repo/core/contract";
import EmptyState from "../components/EmptyState";
import { SleepingCamera } from "../components/illustrations";
import { chip } from "../components/obra/classes";
import TabHeader from "../components/TabHeader";
import { ClaimList, CoverageCard } from "../components/warranty/WarrantyViews";

type Filter = "open" | "all";

export default function WarrantyScreen({
  projectId,
  projectRef,
  warranty,
}: {
  projectId: string;
  projectRef: string;
  warranty: ProjectWarranty;
}) {
  const t = useTranslations("warranty");
  const [filter, setFilter] = useState<Filter>("open");
  const open = warranty.claims.filter((claim) => OPEN_WARRANTY_STATUSES.includes(claim.status));
  const shown = filter === "open" ? open : warranty.claims;

  return (
    <div className="flex flex-col gap-5">
      <TabHeader projectRef={projectRef} title={t("title")} summary={t("summary")} />
      <CoverageCard info={warranty} />
      <section className="flex flex-col gap-3" aria-labelledby="warranty-claims-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="warranty-claims-title">{t("list.title")}</h2>
          <div className="flex gap-2" role="group" aria-label={t("list.filter")}>
            {(["open", "all"] as const).map((key) => (
              <button key={key} type="button" className={chip} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {t(`list.${key}`, { count: key === "open" ? open.length : warranty.claims.length })}
              </button>
            ))}
          </div>
        </div>
        {warranty.claims.length === 0 ? (
          <EmptyState illustration={<SleepingCamera />} title={t("list.emptyTitle")} text={t("list.emptyText")} />
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("list.noneOpen")}</p>
        ) : (
          <ClaimList claims={shown} href={(claim) => `/dashboard/projects/${projectId}/garantia/${claim.id}`} />
        )}
      </section>
    </div>
  );
}
