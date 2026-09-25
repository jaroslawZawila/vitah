"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import {
  MAX_CAPTION_LENGTH,
  MAX_PHOTO_BYTES,
  PHOTO_TYPES,
  type PhotoError,
} from "@repo/core/contract";
import FormError from "./FormError";
import styles from "./photos.module.css";

/** Presentational: upload one photo with an optional caption (shown in a modal). */
export default function PhotoUploadForm({
  action,
  pending,
  error,
  onCancel,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  error?: PhotoError;
  onCancel: () => void;
}) {
  const t = useTranslations("projectDetailPage.photos");
  // Checked here too so an oversized file fails before it is sent.
  const [tooLarge, setTooLarge] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setTooLarge(!!file && file.size > MAX_PHOTO_BYTES);
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  return (
    <form action={action} className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="photo-file">{t("file")}</label>
        <input
          id="photo-file"
          name="file"
          type="file"
          accept={PHOTO_TYPES.join(",")}
          required
          onChange={handleFile}
        />
        <span className={styles.hint}>{t("fileHint")}</span>
      </div>
      {preview && (
        // A local object URL: next/image has nothing to optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt={t("preview")} className={styles.preview} />
      )}
      <div className={styles.field}>
        <label htmlFor="photo-caption">{t("caption")}</label>
        <input id="photo-caption" name="caption" type="text" maxLength={MAX_CAPTION_LENGTH} />
        <span className={styles.hint}>{t("captionHint")}</span>
      </div>
      <FormError
        namespace="projectDetailPage.photos.errors"
        error={tooLarge ? "file_too_large" : error}
      />
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          {t("cancel")}
        </button>
        <button type="submit" className={styles.primary} disabled={pending || tooLarge}>
          {pending ? t("uploading") : t("submit")}
        </button>
      </div>
    </form>
  );
}
