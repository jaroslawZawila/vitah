"use client";

import { useTranslations } from "next-intl";
import type { BudgetRevision } from "@repo/core/contract";
import { textLink } from "../obra/classes";
import { useObraFormat } from "../obra/format";

/**
 * Presentational: the accepted revision is the contract, and what proves it:
 * the day the client accepted and who they are, the staff user who registered
 * it and when, and the client's signed copy. A revision accepted before the
 * registrar was kept shows neither them nor a note about the copy (one may
 * be among the documents, not linked).
 */
export default function AcceptedBanner({
  revision,
  signedHref,
}: {
  revision: BudgetRevision;
  /** Where the signed copy downloads from; null when none is linked. */
  signedHref: string | null;
}) {
  const t = useTranslations("budget");
  const f = useObraFormat();
  const { acceptedByUser: registrar, acceptedAt } = revision;
  return (
    <div className="rounded-[14px] border border-good/30 bg-good-soft px-4 py-3 text-sm">
      <p>
        <b>{t("acceptedBanner", { date: f.date(revision.acceptedOn) })}</b>
        {revision.acceptedBy && ` ${t("acceptedBy", { by: revision.acceptedBy })}`}
      </p>
      {(registrar || signedHref) && (
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-meta text-muted-foreground">
          {registrar && acceptedAt && (
            <span>
              {t("acceptedRegistered", {
                user: registrar.name,
                date: f.dateTime(acceptedAt),
              })}
            </span>
          )}
          {signedHref ? (
            <a href={signedHref} target="_blank" rel="noreferrer" className={textLink}>
              {t("acceptedSigned")}
            </a>
          ) : (
            <span>{t("acceptedUnsigned")}</span>
          )}
        </p>
      )}
    </div>
  );
}
