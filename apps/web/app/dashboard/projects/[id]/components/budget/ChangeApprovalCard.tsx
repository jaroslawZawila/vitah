"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { BudgetApproval, BudgetRevision } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { cardHead, muted, textLink } from "../obra/classes";
import { useObraFormat } from "../obra/format";

/** A change (CAM-) of the project, to link to the revision. */
export type ChangeOption = { id: string; number: number; description: string };

const STATUS_VARIANT = {
  pending: "info",
  approved: "good",
  rejected: "destructive",
  withdrawn: "outline",
  lapsed: "outline",
} as const satisfies Record<BudgetApproval["status"], string>;

/** A change's number as the Obra's Incidencias write it: "CAM-{004}". */
const padded = (number: number) => String(number).padStart(3, "0");

/**
 * Presentational: a revision that changes the contract (Rev.1 on). The changes
 * (CAM-) it prices, linked and unlinked here, and the client's approval in the
 * app: asking for it, its state (waiting since, approved on, rejected with the
 * reason) and the requests before. Handlers are omitted where the user can't act.
 */
export default function ChangeApprovalCard({
  revision,
  changes,
  hasClient,
  pending,
  documentHref,
  onLink,
  onUnlink,
  onAsk,
  onWithdraw,
}: {
  revision: BudgetRevision;
  /** The project's changes (CAM-), to link from. */
  changes: ChangeOption[];
  hasClient: boolean;
  pending: boolean;
  documentHref: (documentId: string) => string;
  onLink?: (issueId: string) => void;
  onUnlink?: (issueId: string) => void;
  onAsk?: () => void;
  onWithdraw?: () => void;
}) {
  const t = useTranslations("budget.approval");
  const f = useObraFormat();
  const id = useId();
  const linked = new Set(revision.changes.map((c) => c.id));
  const candidates = changes.filter((c) => !linked.has(c.id));
  const [picked, setPicked] = useState("");
  const choice = candidates.some((c) => c.id === picked) ? picked : (candidates[0]?.id ?? "");
  const [latest, ...older] = revision.approvals;
  const ref = (number: number) => t("ref", { number: padded(number) });

  return (
    <section className={cardVariants()} aria-labelledby={`${id}-title`}>
      <div className={cardHead}>
        <h2 id={`${id}-title`}>{t("title")}</h2>
        {onAsk && (
          <Button type="button" size="sm" disabled={pending} onClick={onAsk}>
            {t("ask")}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="eyebrow">{t("changes")}</h3>
        {revision.changes.length === 0 ? (
          <p className={muted}>{t("noChanges")}</p>
        ) : (
          <ul className="flex flex-col">
            {revision.changes.map((change) => (
              <li key={change.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b py-1.5 text-sm last:border-b-0">
                <span className="num font-semibold">{ref(change.number)}</span>
                <span className="min-w-0 flex-1 leading-snug">{change.description}</span>
                <span className={muted}>
                  {f.date(change.occurredOn)}
                  {change.costImpactCents !== null && ` · ${t("estimate", { amount: f.signedMoney(change.costImpactCents) })}`}
                </span>
                {onUnlink && (
                  <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => onUnlink(change.id)} aria-label={t("unlinkLabel", { ref: ref(change.number) })}>
                    {t("unlink")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {onLink && candidates.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label={t("pick")} value={choice} onChange={(event) => setPicked(event.target.value)} className="min-w-0 flex-1">
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>{`${ref(c.number)} · ${c.description}`}</option>
              ))}
            </NativeSelect>
            <Button type="button" variant="outline" size="sm" disabled={pending || !choice} onClick={() => onLink(choice)}>
              {t("link")}
            </Button>
          </div>
        )}
        {onLink && changes.length === 0 && <p className={muted}>{t("noneLogged")}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="eyebrow">{t("consent")}</h3>
        {latest ? (
          <ApprovalLine approval={latest} documentHref={documentHref} onWithdraw={latest.status === "pending" ? onWithdraw : undefined} pending={pending} />
        ) : (
          <p className={muted}>{revision.status === "issued" && !hasClient ? t("noClient") : t("notAsked")}</p>
        )}
        {older.length > 0 && (
          <ul className="flex flex-col gap-1">
            {older.map((approval) => (
              <li key={approval.id} className={muted}>
                {t(`history.${approval.status}`, { date: f.date(approval.askedAt) })}
              </li>
            ))}
          </ul>
        )}
        <p className={muted}>{t("evidence")}</p>
      </div>
    </section>
  );
}

/** The newest request: its state, what it showed the client, and withdrawing it. */
function ApprovalLine({
  approval,
  documentHref,
  onWithdraw,
  pending,
}: {
  approval: BudgetApproval;
  documentHref: (documentId: string) => string;
  onWithdraw?: () => void;
  pending: boolean;
}) {
  const t = useTranslations("budget.approval");
  const f = useObraFormat();
  const when = approval.decidedAt ?? approval.closedAt ?? approval.askedAt;
  const state = t(`state.${approval.status}`, {
    date: f.dateTime(when),
    asked: f.dateTime(approval.askedAt),
    by: approval.decidedBy ?? approval.closedBy ?? approval.askedBy ?? "—",
  });
  return (
    <div className="flex flex-col gap-1.5 rounded-[11px] bg-raise px-3.5 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[approval.status]}>{t(`status.${approval.status}`)}</Badge>
        <span>{state}</span>
        {onWithdraw && (
          <Button type="button" variant="ghost-destructive" size="sm" className="ml-auto" disabled={pending} onClick={onWithdraw}>
            {t("withdraw")}
          </Button>
        )}
      </div>
      {approval.rejectReason && <p>{t("reason", { reason: approval.rejectReason })}</p>}
      <p className={muted}>
        {t("amounts", {
          before: f.money(approval.beforeCents),
          after: f.money(approval.afterCents),
          difference: f.signedMoney(approval.afterCents - approval.beforeCents),
        })}
        {approval.documentId && (
          <>
            {" · "}
            <a href={documentHref(approval.documentId)} target="_blank" rel="noreferrer" className={textLink}>
              {t("pdf")}
            </a>
          </>
        )}
      </p>
      {approval.message && <p className={muted}>{t("message", { message: approval.message })}</p>}
    </div>
  );
}
