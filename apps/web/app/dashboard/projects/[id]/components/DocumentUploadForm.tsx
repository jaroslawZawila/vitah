"use client";

import { useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import {
  DOCUMENT_CATEGORIES,
  MAX_DOCUMENT_BYTES,
  type DocumentError,
} from "@repo/core/contract";
import FormError from "./FormError";
import styles from "./DocumentsCard.module.css";

/** Presentational: upload a PDF with a title and category. */
export default function DocumentUploadForm({
  action,
  pending,
  error,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  error?: DocumentError;
}) {
  const t = useTranslations("projectDetailPage.documents");
  // Checked here too so an oversized file fails before it is sent.
  const [tooLarge, setTooLarge] = useState(false);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setTooLarge(!!file && file.size > MAX_DOCUMENT_BYTES);
    // Suggest a title from the file name unless one was typed.
    const title = event.target.form?.elements.namedItem("title");
    if (file && title instanceof HTMLInputElement && !title.value) {
      title.value = file.name.replace(/\.pdf$/i, "");
    }
  }

  return (
    <form action={action} className={styles.form}>
      <h3 className={styles.formTitle}>{t("upload")}</h3>
      <div className={styles.field}>
        <label htmlFor="document-file">{t("file")}</label>
        <input
          id="document-file"
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          required
          onChange={handleFile}
        />
        <span className={styles.hint}>{t("fileHint")}</span>
      </div>
      <div className={styles.field}>
        <label htmlFor="document-title">{t("documentTitle")}</label>
        <input id="document-title" name="title" type="text" required maxLength={200} />
      </div>
      <div className={styles.field}>
        <label htmlFor="document-category">{t("category")}</label>
        <select id="document-category" name="category" required defaultValue="">
          <option value="" disabled>
            {t("chooseCategory")}
          </option>
          {DOCUMENT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t(`categories.${category}`)}
            </option>
          ))}
        </select>
      </div>
      <FormError
        namespace="projectDetailPage.documents.errors"
        error={tooLarge ? "file_too_large" : error}
      />
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={pending || tooLarge}>
          {pending ? t("uploading") : t("submit")}
        </button>
      </div>
    </form>
  );
}
