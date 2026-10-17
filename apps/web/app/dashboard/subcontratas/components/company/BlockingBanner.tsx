"use client";

import { useTranslations } from "next-intl";
import { Ban, Send } from "lucide-react";
import type { SubcontractorDoc, SubcontractorKind } from "@repo/core/contract";
import { addDays } from "@repo/core/obra-calc";
import { Button } from "@/components/ui/button";
import { useDates, useRequirementName } from "../display";

/**
 * Presentational: shown while a company is blocked: since when, which expired
 * documents block it, which workers lose access, and a button to ask for them.
 */
export default function BlockingBanner({
  expired,
  kind,
  workerNames,
  canManage,
  busy,
  onRequest,
}: {
  /** The expired mandatory documents. */
  expired: SubcontractorDoc[];
  kind: SubcontractorKind;
  workerNames: string[];
  canManage: boolean;
  busy: boolean;
  onRequest: () => void;
}) {
  const t = useTranslations("subcontractors.company.banner");
  const name = useRequirementName();
  const { date } = useDates();
  const first = expired.map((d) => d.expiresAt).filter((d): d is string => !!d).sort()[0];
  // Valid through its expiry date: blocked from the day after.

  return (
    <section role="alert" className="flex flex-wrap items-center gap-x-4.5 gap-y-3 rounded-xl bg-bad-soft px-4 py-3.5 text-bad">
      <Ban aria-hidden className="size-5.5 flex-none" />
      <div className="min-w-0 flex-[1_1_380px]">
        <p className="font-semibold">{first ? t("title", { date: date(addDays(first, 1)) }) : t("title", { date: "—" })}</p>
        <p className="text-[13.5px] text-foreground">
          {t("reason", { documents: expired.map((d) => name(d.requirementId, kind)).join(", ") })}{" "}
          {t("workers", { count: workerNames.length, names: workerNames.join(", ") })}
        </p>
      </div>
      {canManage && (
        <Button type="button" className="bg-bad text-white hover:brightness-110" disabled={busy} onClick={onRequest}>
          <Send aria-hidden />
          {t("request")}
        </Button>
      )}
    </section>
  );
}
