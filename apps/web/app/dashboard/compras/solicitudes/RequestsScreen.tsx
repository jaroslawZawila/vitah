"use client";

// Container for Compras › Solicitudes (rail › Red › Compras): the purchase
// requests of every obra, those to approve first. Read-only: a request is
// made, decided and ordered on its obra's page. The views take props only.

import { useTranslations } from "next-intl";
import type { TenantRequests } from "@repo/core/contract";
import { RequestBoard, RequestKpis } from "../../projects/[id]/components/purchasing/RequestViews";

export default function RequestsScreen({ requests }: { requests: TenantRequests }) {
  const t = useTranslations("purchasing.requests.company");
  return (
    <div className="flex flex-col gap-[18px]">
      <header className="min-w-0">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1 className="mt-1.5">{t("title")}</h1>
        <p className="mt-1 max-w-[640px] text-[14px] text-muted-foreground">{t("description")}</p>
      </header>
      <RequestKpis summary={requests.summary} />
      <RequestBoard requests={requests.requests} projects={requests.projects} empty={t("none")} />
    </div>
  );
}
