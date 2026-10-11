"use client";

import { useFormatter, useTranslations } from "next-intl";
import { MAX_DOCUMENT_BYTES, type DocumentError, type ProjectDocument } from "@repo/core/contract";
import FormError from "../../../components/FormError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useObraFormat } from "./obra/format";

/** "PDF", "BC3", "XLSX"…: the file's kind, from its name. */
const typeOf = (document: ProjectDocument) =>
  document.contentType === "application/pdf" ? "PDF" : (document.filename?.split(".").pop()?.toUpperCase() ?? "—");

/** Whether the app can show it: a PDF it can download (budget inputs may be neither). */
const shareable = (document: ProjectDocument) =>
  document.contentType === "application/pdf" && document.sizeBytes <= MAX_DOCUMENT_BYTES;

/**
 * Presentational: the project's documents, each with a link to the file, a
 * switch for whether the client sees it in the app (`onToggleVisibility`) and
 * a delete (`onDelete`; never on an issued budget's PDFs).
 */
export default function DocumentList({
  documents,
  fileUrl,
  onDelete,
  onToggleVisibility,
  deleting,
  error,
}: {
  documents: ProjectDocument[];
  fileUrl: (document: ProjectDocument) => string;
  /** Omitted for users who can't delete. */
  onDelete?: (document: ProjectDocument) => void;
  onToggleVisibility?: (document: ProjectDocument, visible: boolean) => void;
  deleting: boolean;
  error?: DocumentError;
}) {
  const t = useTranslations("projectDetailPage.documents");
  const format = useFormatter();

  const f = useObraFormat();

  return (
    <>
      <ul>
        {documents.map((document) => {
          const origin = document.budgetPdf ? "budgetPdf" : document.budgetInput ? "budgetInput" : null;
          return (
            <li
              key={document.id}
              className="flex min-h-14 flex-wrap items-center gap-3 border-b py-2.5 text-[13.5px] last:border-b-0"
            >
              <span
                className="grid h-[42px] w-9 flex-none place-items-center rounded-sm border bg-raise text-[9.5px] font-semibold tracking-[0.04em] text-brand-ink"
                aria-hidden
              >
                {typeOf(document)}
              </span>
              <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
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
                    document.filename,
                    t(`categories.${document.category}`),
                    format.dateTime(new Date(document.uploadedAt), {
                      dateStyle: "medium",
                      // Fixed zone: server and browser must render the same text.
                      timeZone: "Europe/Madrid",
                    }),
                    f.fileSize(document.sizeBytes),
                    document.uploadedBy,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {origin && <Badge variant={origin === "budgetPdf" ? "default" : "outline"}>{t(`origins.${origin}`)}</Badge>}
              {onToggleVisibility && shareable(document) ? (
                <button
                  type="button"
                  aria-pressed={document.visibleToClient}
                  aria-label={t("visibleLabel", { title: document.title })}
                  onClick={() => onToggleVisibility(document, !document.visibleToClient)}
                  className="inline-flex min-h-11 items-center gap-2 px-1 text-[13px] font-semibold"
                >
                  <span className={cn("relative h-5 w-9 flex-none rounded-full bg-border transition-colors", document.visibleToClient && "bg-good")} aria-hidden>
                    <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-all", document.visibleToClient && "left-[18px]")} />
                  </span>
                  {document.visibleToClient ? t("visible") : t("hidden")}
                </button>
              ) : (
                !document.visibleToClient && <Badge variant="outline">{t("hidden")}</Badge>
              )}
              {onDelete && !document.budgetPdf && (
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
          );
        })}
      </ul>
      <FormError namespace="projectDetailPage.documents.errors" error={error} />
    </>
  );
}
