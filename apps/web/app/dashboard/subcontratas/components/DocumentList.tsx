"use client";

import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Eye, Upload } from "lucide-react";
import { requirement, type SubcontractorDoc, type SubcontractorKind } from "@repo/core/contract";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DocStateBadge } from "./Badges";
import { useDates, useRequirementBasis, useRequirementName, versionUrl } from "./display";
import { touchLink } from "../../components/touch";
import { phoneLabel } from "../../components/phone-table";

export type DocumentGroup = { key: string; title: string; documents: SubcontractorDoc[] };

export type DocumentHandlers = {
  onUpload: (doc: SubcontractorDoc) => void;
  onValidate: (doc: SubcontractorDoc) => void;
  onReject: (doc: SubcontractorDoc) => void;
  onNotApplicable: (doc: SubcontractorDoc) => void;
  onRequest: (doc: SubcontractorDoc) => void;
};

const REQUESTABLE = new Set(["missing", "rejected", "expired", "requested", "expiring"]);

/**
 * Below 768px the table reflows into one block per document (the same elements):
 * its name, then its state and dates on a line, each with its column's name, then
 * its actions.
 */
const phone = {
  block: "max-md:block",
  row: "max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-3 max-md:gap-y-1.5 max-md:py-3",
  full: "max-md:basis-full max-md:p-0",
  item: "max-md:flex max-md:items-center max-md:gap-1.5 max-md:p-0",
  label: phoneLabel,
};

/**
 * Presentational: a company's or worker's documents, in groups, with their
 * state, dates, current version and reviewer, and what staff can do with each.
 * Older versions open underneath.
 */
export default function DocumentList({
  groups,
  subcontractorId,
  kind,
  canManage,
  busy = false,
  ...handlers
}: {
  groups: DocumentGroup[];
  subcontractorId: string;
  kind: SubcontractorKind;
  canManage: boolean;
  busy?: boolean;
} & DocumentHandlers) {
  const t = useTranslations("subcontractors.documents");
  const name = useRequirementName();
  const basis = useRequirementBasis();
  const { date } = useDates();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Table className={cn(phone.block, "md:min-w-[860px]")}>
      <TableHeader className="max-md:hidden">
        <TableRow>
          <TableHead>{t("document")}</TableHead>
          <TableHead>{t("state")}</TableHead>
          <TableHead>{t("issued")}</TableHead>
          <TableHead>{t("expires")}</TableHead>
          <TableHead>{t("version")}</TableHead>
          <TableHead>{t("validatedBy")}</TableHead>
          <TableHead className="text-right">{t("actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className={phone.block}>
        {groups.map((group) => (
          <Fragment key={group.key}>
            <TableRow className={cn(phone.block, "hover:bg-transparent")}>
              <TableCell colSpan={7} className="max-md:block bg-raise py-1.5 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {group.title}
              </TableCell>
            </TableRow>
            {group.documents.map((doc) => {
              const key = `${doc.requirementId}|${doc.workerId ?? ""}|${doc.projectId ?? ""}`;
              const docName = name(doc.requirementId, kind);
              const current = doc.current;
              const expanded = open === key;
              const optional = !requirement(doc.requirementId)?.mandatory && !doc.workerId;
              return (
                <Fragment key={key}>
                  <TableRow className={phone.row}>
                    <TableCell className={cn("min-w-56 whitespace-normal", phone.full)}>
                      <div className="font-semibold">{docName}</div>
                      <div className="text-meta text-muted-foreground">{basis(doc.requirementId)}</div>
                      {doc.state === "not_applicable" && doc.notApplicableReason && (
                        <div className="text-meta text-muted-foreground">
                          {t("reasonLine", { reason: doc.notApplicableReason })}
                        </div>
                      )}
                      {doc.state === "rejected" && current?.rejectReason && (
                        <div className="text-meta text-destructive">{t("reasonLine", { reason: current.rejectReason })}</div>
                      )}
                      {doc.state === "requested" && doc.requestedAt && (
                        <div className="text-meta text-muted-foreground">{t("requestedOn", { date: date(doc.requestedAt) })}</div>
                      )}
                    </TableCell>
                    <TableCell className={phone.item}>
                      <DocStateBadge state={doc.state} daysLeft={doc.daysLeft} />
                    </TableCell>
                    <TableCell className={cn("num", phone.item, !doc.issuedAt && "max-md:hidden")}>
                      <span className={phone.label}>{t("issued")}</span>
                      {date(doc.issuedAt)}
                    </TableCell>
                    <TableCell className={cn("num", phone.item, !doc.expiresAt && !current && "max-md:hidden")}>
                      <span className={phone.label}>{t("expires")}</span>
                      {doc.expiresAt ? date(doc.expiresAt) : current ? t("noExpiry") : "—"}
                    </TableCell>
                    <TableCell className={cn(phone.item, !current && "max-md:hidden")}>
                      <span className={phone.label}>{t("version")}</span>
                      {current ? (
                        <button
                          type="button"
                          className="inline-flex min-h-7 items-center gap-1 rounded-md px-1 num text-foreground hover:bg-raise pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
                          aria-expanded={expanded}
                          onClick={() => setOpen(expanded ? null : key)}
                        >
                          v{current.version}
                          {doc.versions.length > 1 && (
                            <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
                          )}
                          <span className="sr-only">{t("versions")}</span>
                        </button>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className={cn("min-w-24 text-meta whitespace-normal", phone.item, current?.outcome !== "validated" && "max-md:hidden")}>
                      <span className={phone.label}>{t("validatedBy")}</span>
                      {current?.outcome === "validated" ? `${current.reviewedBy ?? "—"} · ${date(current.reviewedAt)}` : "—"}
                    </TableCell>
                    <TableCell className={phone.full}>
                      {/* Wraps onto a second line rather than run past the card. */}
                      <div className="flex flex-wrap gap-1.5 md:justify-end">
                        {current && (
                          <a
                            className={buttonVariants({ variant: "ghost", size: "sm" })}
                            href={versionUrl(subcontractorId, current.id)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Eye aria-hidden />
                            {t("view")}
                          </a>
                        )}
                        {canManage && doc.status === "uploaded" && (
                          <>
                            <Button type="button" size="sm" disabled={busy} onClick={() => handlers.onValidate(doc)}>
                              {t("validate")}
                            </Button>
                            <Button type="button" size="sm" variant="ghost-destructive" disabled={busy} onClick={() => handlers.onReject(doc)}>
                              {t("reject")}
                            </Button>
                          </>
                        )}
                        {canManage && REQUESTABLE.has(doc.state) && (
                          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => handlers.onRequest(doc)}>
                            {doc.state === "requested" || doc.state === "expiring" ? t("remind") : t("request")}
                          </Button>
                        )}
                        {canManage && optional && doc.state === "missing" && (
                          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => handlers.onNotApplicable(doc)}>
                            {t("notApplicable")}
                          </Button>
                        )}
                        {canManage && (
                          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => handlers.onUpload(doc)}>
                            <Upload aria-hidden />
                            {current ? t("newVersion") : t("upload")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow className={cn(phone.block, "hover:bg-transparent")}>
                      <TableCell colSpan={7} className="bg-raise pb-3 pl-7 whitespace-normal max-md:block">
                        <p className="eyebrow mb-1">{t("versions")}</p>
                        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-meta text-muted-foreground">
                          {doc.versions.map((v) => (
                            <li key={v.id}>
                              <a className={cn("text-foreground underline-offset-2 hover:underline", touchLink)} href={versionUrl(subcontractorId, v.id)} target="_blank" rel="noreferrer">
                                {v.uploadedBy
                                  ? t("versionLine", { version: v.version, date: date(v.uploadedAt), user: v.uploadedBy })
                                  : t("versionLineAnonymous", { version: v.version, date: date(v.uploadedAt) })}
                              </a>
                              {v.outcome === "validated" &&
                                ` · ${t("validatedLine", { date: date(v.reviewedAt), user: v.reviewedBy ?? "—" })}`}
                              {v.outcome === "rejected" &&
                                ` · ${t("rejectedLine", { date: date(v.reviewedAt), user: v.reviewedBy ?? "—", reason: v.rejectReason ?? "" })}`}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}
