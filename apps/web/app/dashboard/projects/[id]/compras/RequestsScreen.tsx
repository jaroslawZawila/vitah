"use client";

// Container for the project's Compras › Solicitudes: what the obra asks to
// buy, those to approve first. Read-only: requests are written on their own
// pages. The views in ../components/purchasing take props only.

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import type { TenantRequests } from "@repo/core/contract";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StageEyebrow, type ObraHeader } from "../components/construction/ObraFrame";
import { ViewSwitch } from "../components/purchasing/LineViews";
import { newRequestHref } from "../components/purchasing/links";
import { RequestBoard, RequestKpis } from "../components/purchasing/RequestViews";

export default function RequestsScreen({
  projectId,
  header,
  requests,
  canManage,
}: {
  projectId: string;
  header: ObraHeader;
  requests: TenantRequests;
  canManage: boolean;
}) {
  const t = useTranslations("purchasing.requests.project");
  return (
    <div className="flex flex-col gap-[18px]">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <StageEyebrow label={header.ref} stage={header.stage} />
          <h1 className="mt-1.5">{t("title")}</h1>
          <p className="mt-1 max-w-[640px] text-[14px] text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto">
          <ViewSwitch projectId={projectId} view="requests" />
          {canManage && (
            <Link href={newRequestHref(projectId)} className={cn(buttonVariants(), "w-full sm:w-auto")}>
              <Plus aria-hidden />
              {t("new")}
            </Link>
          )}
        </div>
      </header>

      <RequestKpis summary={requests.summary} />
      <RequestBoard requests={requests.requests} empty={t("none")} />
      <p className="max-w-[860px] text-[12.5px] leading-normal text-muted-foreground">{t("footnote")}</p>
    </div>
  );
}
