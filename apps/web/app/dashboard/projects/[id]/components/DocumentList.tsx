"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { DocumentError, ProjectDocument } from "@repo/core/contract";
import FormError from "./FormError";
import styles from "./DocumentsCard.module.css";

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

  if (documents.length === 0) {
    return <p className={styles.empty}>{t("empty")}</p>;
  }

  const size = (bytes: number) =>
    bytes < MB
      ? format.number(Math.max(1, Math.round(bytes / 1024)), { style: "unit", unit: "kilobyte" })
      : format.number(bytes / MB, {
          style: "unit",
          unit: "megabyte",
          maximumFractionDigits: 1,
        });

  return (
    <>
      <ul className={styles.list}>
        {documents.map((document) => (
          <li key={document.id} className={styles.row}>
            <span className={styles.fileType} aria-hidden>
              PDF
            </span>
            <div className={styles.details}>
              <a
                href={fileUrl(document)}
                target="_blank"
                rel="noreferrer"
                className={styles.title}
              >
                {document.title}
              </a>
              <span className={styles.meta}>
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
              <button
                type="button"
                className={styles.delete}
                onClick={() => onDelete(document)}
                disabled={deleting}
                aria-label={t("deleteLabel", { title: document.title })}
              >
                {t("delete")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <FormError namespace="projectDetailPage.documents.errors" error={error} />
    </>
  );
}
