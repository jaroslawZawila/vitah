"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { DocumentError, ProjectDocument } from "@repo/core/contract";
import FormError from "../../../components/FormError";
import { Button } from "@/components/ui/button";

const MB = 1024 * 1024;

/** Presentational: the project's documents, each with a link to the file. */
export default function DocumentList({
  documents,
  fileUrl,
  onDelete,
  deleting,
  error,
}: {
  documents: ProjectDocument[];
  fileUrl: (document: ProjectDocument) => string;
  /** Omitted for users who can't delete. */
  onDelete?: (document: ProjectDocument) => void;
  deleting: boolean;
  error?: DocumentError;
}) {
  const t = useTranslations("projectDetailPage.documents");
  const format = useFormatter();

  const size = (bytes: number) =>
    bytes < MB
      ? format.number(Math.max(1, Math.round(bytes / 1024)), {
          style: "unit",
          unit: "kilobyte",
        })
      : format.number(bytes / MB, {
          style: "unit",
          unit: "megabyte",
          maximumFractionDigits: 1,
        });

  return (
    <>
      <ul>
        {documents.map((document) => (
          <li
            key={document.id}
            className="flex min-h-14 items-center gap-3 border-b py-2.5 text-[13.5px] last:border-b-0"
          >
            <span
              className="grid h-[42px] w-9 flex-none place-items-center rounded-sm border bg-raise text-[9.5px] font-semibold tracking-[0.04em] text-brand-ink"
              aria-hidden
            >
              PDF
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <a
                href={fileUrl(document)}
                target="_blank"
                rel="noreferrer"
                className="font-semibold wrap-anywhere text-foreground transition-colors hover:text-primary hover:underline focus-visible:text-primary focus-visible:underline"
              >
                {document.title}
              </a>
              <span className="text-xs wrap-anywhere text-muted-foreground">
                {[
                  t(`categories.${document.category}`),
                  format.dateTime(new Date(document.uploadedAt), {
                    dateStyle: "medium",
                    // Fixed zone: server and browser must render the same text.
                    timeZone: "Europe/Madrid",
                  }),
                  size(document.sizeBytes),
                  document.uploadedBy,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            {onDelete && (
              <Button
                type="button"
                variant="ghost-destructive"
                size="sm"
                onClick={() => onDelete(document)}
                disabled={deleting}
                aria-label={t("deleteLabel", { title: document.title })}
              >
                {t("delete")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <FormError namespace="projectDetailPage.documents.errors" error={error} />
    </>
  );
}
