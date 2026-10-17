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
    <Table className="min-w-[1000px]">
      <TableHeader>
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
      <TableBody>
        {groups.map((group) => (
          <Fragment key={group.key}>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={7} className="bg-raise py-1.5 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
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
                  <TableRow>
                    <TableCell className="min-w-72 whitespace-normal">
                      <div className="font-semibold">{docName}</div>
                      <div className="text-[12.5px] text-muted-foreground">
                        {basis(doc.requirementId)} · <span className="num">{doc.requirementId}</span>
                      </div>
                      {doc.state === "not_applicable" && doc.notApplicableReason && (
                        <div className="text-[12.5px] text-muted-foreground">
                          {t("reasonLine", { reason: doc.notApplicableReason })}
                        </div>
                      )}
                      {doc.state === "rejected" && current?.rejectReason && (
                        <div className="text-[12.5px] text-destructive">{t("reasonLine", { reason: current.rejectReason })}</div>
                      )}
                      {doc.state === "requested" && doc.requestedAt && (
                        <div className="text-[12.5px] text-muted-foreground">{t("requestedOn", { date: date(doc.requestedAt) })}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <DocStateBadge state={doc.state} daysLeft={doc.daysLeft} />
                    </TableCell>
                    <TableCell className="num">{date(doc.issuedAt)}</TableCell>
                    <TableCell className="num">{doc.expiresAt ? date(doc.expiresAt) : current ? t("noExpiry") : "—"}</TableCell>
                    <TableCell>
                      {current ? (
                        <button
                          type="button"
                          className="inline-flex min-h-7 items-center gap-1 rounded-md px-1 num text-foreground hover:bg-raise"
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
                    <TableCell className="text-[12.5px]">
                      {current?.outcome === "validated" ? `${current.reviewedBy ?? "—"} · ${date(current.reviewedAt)}` : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
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
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="bg-raise pb-3 pl-7 whitespace-normal">
                        <p className="eyebrow mb-1">{t("versions")}</p>
                        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-muted-foreground">
                          {doc.versions.map((v) => (
                            <li key={v.id}>
                              <a className="text-foreground underline-offset-2 hover:underline" href={versionUrl(subcontractorId, v.id)} target="_blank" rel="noreferrer">
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
