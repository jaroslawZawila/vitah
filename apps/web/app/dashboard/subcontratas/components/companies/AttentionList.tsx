"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import type { AttentionItem, SubcontractorKind } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DocStateBadge } from "../Badges";
import { DOC_STATE_VARIANT, companyHref, useDates, useRequirementName } from "../display";

const ICON_TONE: Record<string, string> = {
  destructive: "bg-bad-soft text-bad",
  warn: "bg-warn-soft text-warn",
  yel: "bg-yel-soft text-yel",
  info: "bg-info-soft text-info",
};

/** Which action an item offers: ask for it, remind, or go and validate it. */
export function attentionAction(item: AttentionItem): "request" | "remind" | "validate" {
  if (item.state === "uploaded") return "validate";
  if (item.state === "requested" || item.state === "expiring") return "remind";
  return "request";
}

/**
 * Presentational: "Requiere atención", what needs doing first (expired,
 * rejected, missing, to validate, requested, expiring). `#caducidades` links here.
 */
export default function AttentionList({
  items,
  kindOf,
  canManage,
  busy,
  onRequest,
}: {
  items: AttentionItem[];
  kindOf: (subcontractorId: string) => SubcontractorKind;
  canManage: boolean;
  busy: boolean;
  onRequest: (item: AttentionItem) => void;
}) {
  const t = useTranslations("subcontractors.companies.attention");
  const name = useRequirementName();
  const { date } = useDates();

  function when(item: AttentionItem) {
    if (!item.date) return null;
    if (item.state === "expired") return t("expiredOn", { date: date(item.date) });
    if (item.state === "expiring") return t("expiresOn", { date: date(item.date) });
    if (item.state === "uploaded") return t("uploadedOn", { date: date(item.date) });
    return t("requestedOn", { date: date(item.date) });
  }

  return (
    <section id="caducidades" className={cn(cardVariants(), "scroll-mt-4")} aria-labelledby="attention-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <h2 id="attention-title">{t("title")}</h2>
          {items.length > 0 && <Badge variant="destructive">{items.length}</Badge>}
        </div>
        <span className="text-[12.5px] text-muted-foreground">{t("hint")}</span>
      </div>
      {items.length === 0 ? (
        <p className="py-4 text-[13.5px] text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((item) => {
            const kind = kindOf(item.subcontractorId);
            const many = item.requirementIds.length > 1;
            const title = many
              ? t("missingDocs", { count: item.requirementIds.length })
              : name(item.requirementIds[0]!, kind);
            const who = [item.workerName, item.subcontractorName, item.projectRef && t("obra", { ref: item.projectRef })]
              .filter(Boolean)
              .join(" · ");
            const action = attentionAction(item);
            const detail = [when(item), item.affectedWorkers > 0 && t("affected", { count: item.affectedWorkers })]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={`${item.documentId ?? item.subcontractorId}|${item.requirementIds.join(",")}|${item.projectId ?? ""}`}
                className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t py-3 first:border-t-0 first:pt-1"
              >
                <span
                  aria-hidden
                  className={cn("grid size-8 flex-none place-items-center rounded-[9px]", ICON_TONE[DOC_STATE_VARIANT[item.state]])}
                >
                  <AlertTriangle className="size-4" />
                </span>
                <div className="min-w-0 flex-[1_1_260px]">
                  <div className="font-semibold">{title}</div>
                  <div className="text-[12.5px] text-muted-foreground">
                    {who}
                    {many && ` · ${item.requirementIds.map((id) => name(id, kind)).join(", ")}`}
                  </div>
                </div>
                {detail && <div className="flex-[0_1_220px] text-[12.5px] text-muted-foreground">{detail}</div>}
                <DocStateBadge state={item.state} daysLeft={item.daysLeft} />
                {canManage &&
                  (action === "validate" ? (
                    <Link
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      href={`${companyHref(item.subcontractorId)}?tab=documentos`}
                    >
                      {t("validate")}
                    </Link>
                  ) : (
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onRequest(item)}>
                      {t(action)}
                    </Button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
