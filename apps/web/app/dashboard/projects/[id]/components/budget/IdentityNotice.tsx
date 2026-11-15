"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { BudgetRevision, IdentityField } from "@repo/core/contract";
import { Button, buttonVariants } from "@/components/ui/button";
import { muted, textLink } from "../obra/classes";

/**
 * Presentational: where a revision's promoter or site don't name the
 * project's client or address (`revision.identity`). On a draft, in full (the
 * Texts tab): both values side by side and, for editors (`onUse`,
 * `generalHref`), "Usar los datos del proyecto" or a link to correct the
 * project instead; what the draft names and the project lacks is only
 * mentioned. With `textsHref` (the summary), one quiet line linking there. An
 * issued revision (or rejected, or accepted) was given to the client: a quiet
 * read-only note, never an action.
 */
export default function IdentityNotice({
  revision,
  textsHref,
  generalHref,
  pending = false,
  onUse,
}: {
  revision: BudgetRevision;
  /** The quiet one-line form, linking to the Texts tab. */
  textsHref?: string;
  /** The project's General tab, to correct the project instead. */
  generalHref?: string;
  pending?: boolean;
  onUse?: () => void;
}) {
  const t = useTranslations("budget.texts");
  const { identity } = revision;
  if (!identity) return null;
  const { differs, projectLacks } = identity;
  const cover = revision.texts.cover;
  const projectValue = (field: IdentityField) => (field === "promoter" ? identity.client : identity.address) ?? "";

  if (revision.status !== "draft") {
    if (differs.length === 0) return null;
    const list = differs.map((field) => t("identity.field", { field, value: projectValue(field) })).join(" · ");
    return <p className={muted}>{t("identity.frozen", { list })}</p>;
  }
  if (textsHref) {
    if (differs.length === 0) return null;
    return (
      <p className={muted}>
        {t("identity.summary")}{" "}
        <Link href={textsHref} className={textLink}>
          {t("identity.review")}
        </Link>
      </p>
    );
  }
  if (differs.length === 0 && projectLacks.length === 0) return null;
  return (
    <section role="status" aria-label={t("identity.title")} className="flex flex-col gap-3 rounded-[14px] border border-warn/30 bg-warn-soft px-4 py-3.5 text-sm">
      {differs.length > 0 && (
        <>
          <b>{t("identity.title")}</b>
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,auto)_minmax(0,1fr)_minmax(0,1fr)]">
            {differs.map((field) => (
              <div key={field} className="contents">
                <dt className="font-semibold">{t(`coverFields.${field}`)}</dt>
                <dd className="min-w-0 break-words">
                  <span className="eyebrow block">{t("identity.inBudget")}</span>
                  {cover[field] || <span className="text-muted-foreground">{t("identity.empty")}</span>}
                </dd>
                <dd className="min-w-0 break-words">
                  <span className="eyebrow block">{t("identity.inProject")}</span>
                  {projectValue(field)}
                </dd>
              </div>
            ))}
          </dl>
          {(onUse || generalHref) && (
            <span className="flex flex-wrap items-center gap-2">
              {onUse && (
                <Button type="button" size="sm" disabled={pending} onClick={onUse}>
                  {t("identity.use")}
                </Button>
              )}
              {generalHref && (
                <Link href={generalHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {t("identity.correctProject")}
                </Link>
              )}
            </span>
          )}
        </>
      )}
      {projectLacks.map((field) => (
        <p key={field} className="text-muted-foreground">
          {t("identity.projectLacks", { field, value: cover[field] })}{" "}
          {generalHref && (
            <Link href={generalHref} className={textLink}>
              {t("identity.openGeneral")}
            </Link>
          )}
        </p>
      ))}
    </section>
  );
}
