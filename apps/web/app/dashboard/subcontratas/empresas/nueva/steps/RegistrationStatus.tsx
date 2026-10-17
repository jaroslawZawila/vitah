"use client";

import { useTranslations } from "next-intl";
import { Check, Minus, TriangleAlert } from "lucide-react";
import { MANDATORY_COMPANY_REQUIREMENTS, provinceForPostalCode, type ProjectOption } from "@repo/core/contract";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CompanyStatusBadge } from "../../../components/Badges";
import { activityComplete, companyDataComplete, permanentShareLow, taxIdValid } from "../../../components/fields/draft";
import { mandatoryChosen, type CompanyFlowDraft } from "../draft";

type Tone = "good" | "warn" | "yel" | "muted";

const MARK: Record<Tone, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  yel: "bg-yel-soft text-yel",
  muted: "border bg-raise text-muted-foreground",
};

function Item({ tone, title, detail }: { tone: Tone; title: string; detail: string }) {
  const Icon = tone === "good" ? Check : tone === "muted" ? Minus : TriangleAlert;
  return (
    <li className="flex items-start gap-2.5 border-t py-2.5 text-[13.5px] first:border-t-0 first:pt-0">
      <span className={cn("grid size-[22px] flex-none place-items-center rounded-full", MARK[tone])}>
        <Icon aria-hidden className="size-3" strokeWidth={2.4} />
      </span>
      <span className="min-w-0">
        <b className="font-semibold">{title}</b>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </li>
  );
}

/**
 * Presentational: "Estado del alta", beside the wizard. A new company always
 * starts Pendiente: its documents wait for validation.
 */
export default function RegistrationStatus({ draft, projects }: { draft: CompanyFlowDraft; projects: ProjectOption[] }) {
  const t = useTranslations("subcontractors.wizard.status");
  const tr = useTranslations("subcontractors");
  const place = provinceForPostalCode(draft.postalCode.trim());
  const dataOk = companyDataComplete(draft);
  const low = permanentShareLow(draft);
  const activityOk = activityComplete(draft);
  const chosen = mandatoryChosen(draft);
  const total = MANDATORY_COMPANY_REQUIREMENTS.length;
  const project = projects.find((p) => p.id === draft.obra.projectId);

  return (
    <aside className="flex min-w-0 flex-col gap-3.5 lg:w-[320px] lg:flex-none">
      <Card aria-labelledby="registration-status">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="registration-status">{t("title")}</h2>
          <CompanyStatusBadge status="pendiente" />
        </div>
        <ul className="m-0 flex list-none flex-col p-0">
          <Item
            tone={dataOk ? "good" : "muted"}
            title={t("data")}
            detail={
              dataOk && place
                ? t("dataOk", { region: tr(`regions.${place.region}`) })
                : taxIdValid(draft) === false
                  ? tr("errors.invalid_tax_id")
                  : t("dataPending")
            }
          />
          <Item
            tone={!activityOk ? "warn" : low ? "warn" : draft.trades.length > 0 ? "good" : "muted"}
            title={t("activity")}
            detail={
              !activityOk
                ? t("activityInvalid")
                : low
                  ? t("activityLowShare")
                  : draft.trades.length > 0
                    ? draft.trades.map((trade) => tr(`trades.${trade}`)).join(", ")
                    : t("activityPending")
            }
          />
          <Item
            tone={chosen === total ? "good" : "yel"}
            title={t("documents")}
            detail={t("documentsDetail", { chosen, total })}
          />
          <Item
            tone={project ? "good" : "muted"}
            title={t("obra")}
            detail={
              project
                ? draft.obra.chapterCodes.length > 0
                  ? t("obraChapters", { ref: project.ref, chapters: draft.obra.chapterCodes.join(", ") })
                  : project.ref
                : t("obraNone")
            }
          />
        </ul>
      </Card>
      <Card className="bg-raise shadow-none">
        <p className="eyebrow">{t("whenApta")}</p>
        <p className="m-0 text-[13px]">{t("whenAptaDetail", { total })}</p>
      </Card>
    </aside>
  );
}
