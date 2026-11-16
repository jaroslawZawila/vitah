"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { workerName, type SubcontractorKind, type WorkerListItem } from "@repo/core/contract";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccessBadge, DocStateBadge } from "../Badges";
import { useAccessReason, workerHref } from "../display";
import { cn } from "@/lib/utils";
import { stretchedLink, touchLink } from "../../../components/touch";

/** Presentational: the company's workers and their site access. */
export default function WorkersTab({
  workers,
  subcontractorId,
  kind,
  canManage,
}: {
  workers: WorkerListItem[];
  subcontractorId: string;
  kind: SubcontractorKind;
  canManage: boolean;
}) {
  const t = useTranslations("subcontractors.company.workers");
  const ts = useTranslations("subcontractors");
  const reason = useAccessReason();

  return (
    <section className={cardVariants()} aria-labelledby="workers-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="workers-title">{t("title")}</h2>
        {canManage && (
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            href={`/dashboard/subcontratas/trabajadores/nuevo?empresa=${subcontractorId}`}
          >
            <Plus aria-hidden />
            {t("register")}
          </Link>
        )}
      </div>
      {workers.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
        {/* Phones: one card per worker, opening their page. */}
        <ul className="m-0 flex list-none flex-col p-0 md:hidden">
          {workers.map((w) => {
            const failing = w.access.checks.find((c) => !c.ok)?.reasons[0];
            const tpc = w.docs.tpc;
            return (
              <li key={w.id} className="relative flex flex-col gap-1.5 border-t py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={workerHref(w.id)} className={cn("font-semibold hover:text-primary", stretchedLink)}>
                    {workerName(w)}
                  </Link>
                  <AccessBadge status={w.access.status} />
                </div>
                <div className="text-meta text-muted-foreground">
                  <span className="num">{w.idDocumentMasked}</span>
                  {[w.trade && ts(`trades.${w.trade}`), w.category && ts(`categories.${w.category}`), ...w.roles.map((role) => ts(`roles.${role}`))]
                    .filter(Boolean)
                    .map((text) => ` · ${text}`)}
                </div>
                {failing && <div className="text-meta text-muted-foreground">{reason(failing, kind)}</div>}
                {tpc && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-meta text-muted-foreground">{t("tpc")}</span>
                    <DocStateBadge state={tpc.state} daysLeft={tpc.daysLeft} short />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="hidden md:block">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead>{t("name")}</TableHead>
              <TableHead>{t("trade")}</TableHead>
              <TableHead>{t("tpc")}</TableHead>
              <TableHead>{t("roles")}</TableHead>
              <TableHead>{t("access")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workers.map((w) => {
              const failing = w.access.checks.find((c) => !c.ok)?.reasons[0];
              const tpc = w.docs.tpc;
              return (
                <TableRow key={w.id}>
                  <TableCell>
                    <Link href={workerHref(w.id)} className={cn("font-semibold hover:underline hover:underline-offset-3", touchLink)}>
                      {workerName(w)}
                    </Link>
                    <div className="num text-meta text-muted-foreground">{w.idDocumentMasked}</div>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {[w.trade && ts(`trades.${w.trade}`), w.category && ts(`categories.${w.category}`)]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </TableCell>
                  <TableCell>{tpc ? <DocStateBadge state={tpc.state} daysLeft={tpc.daysLeft} short /> : "—"}</TableCell>
                  <TableCell className="whitespace-normal">
                    {w.roles.map((role) => ts(`roles.${role}`)).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <AccessBadge status={w.access.status} />
                    {failing && <div className="mt-0.5 text-meta text-muted-foreground">{reason(failing, kind)}</div>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </div>
        </>
      )}
    </section>
  );
}
