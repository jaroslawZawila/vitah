"use client";

// Container for Obra › Planificación › Versiones: which version is picked.
// The views in ../../../components/planning take props only.

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PlanningVersions } from "@repo/core/contract";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import BackLink from "../../../../../components/BackLink";
import { planningHref } from "../../../components/planning/links";
import { VersionCompare, VersionList } from "../../../components/planning/VersionViews";

/** Every version of the plan, and what the one picked changed against the one before. */
export default function VersionsScreen({ projectId, data }: { projectId: string; data: PlanningVersions }) {
  const t = useTranslations("planning.versions");
  const { versions } = data;
  // The baseline first: the draft (if any) is a click away.
  const [picked, setPicked] = useState(() => (versions.find((v) => v.status === "approved") ?? versions[0])?.id ?? "");
  const index = versions.findIndex((v) => v.id === picked);
  const version = versions[index];

  return (
    <div className="flex flex-col gap-[18px]">
      <BackLink href={planningHref(projectId)} />
      <header className="min-w-0">
        <span className="eyebrow text-brand-ink">{t("eyebrow", { ref: data.ref })}</span>
        <h1 className="mt-1.5">{t("title")}</h1>
        <p className="mt-1 max-w-[80ch] text-[14px] text-muted-foreground">{t("description")}</p>
      </header>
      {version ? (
        <div className="flex flex-wrap items-start gap-[18px]">
          <div className="min-w-0 flex-[1_1_300px]">
            <VersionList versions={versions} picked={picked} onPick={setPicked} />
          </div>
          <div className="min-w-0 flex-[999_1_560px]">
            <VersionCompare version={version} previous={versions[index + 1] ?? null} />
          </div>
        </div>
      ) : (
        <p className={cn(cardVariants(), "text-center text-[13.5px] text-muted-foreground")}>{t("empty")}</p>
      )}
    </div>
  );
}
