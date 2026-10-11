"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import {
  MAX_CAPTION_LENGTH,
  MAX_PHOTO_BYTES,
  PHOTO_TYPES,
  type PhotoError,
} from "@repo/core/contract";
import FormError from "../../../components/FormError";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Presentational: upload one photo with an optional caption (shown in a modal). */
export default function PhotoUploadForm({
  action,
  pending,
  error,
  onCancel,
  chapterCode,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  error?: PhotoError;
  onCancel: () => void;
  /** The budget chapter the photo shows, e.g. "05" (from a chapter's page). */
  chapterCode?: string;
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
    <form action={action} className="flex flex-col gap-3">
      {chapterCode && <input type="hidden" name="chapterCode" value={chapterCode} />}
      <Field>
        <Label htmlFor="photo-file">{t("file")}</Label>
        <Input
          id="photo-file"
          name="file"
          type="file"
          accept={PHOTO_TYPES.join(",")}
          required
          onChange={handleFile}
        />
        <FieldDescription>{t("fileHint")}</FieldDescription>
      </Field>
      {preview && (
        // A local object URL: next/image has nothing to optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt={t("preview")}
          className="block max-h-60 w-full rounded-md bg-raise object-contain"
        />
      )}
      <Field>
        <Label htmlFor="photo-caption">{t("caption")}</Label>
        <Input id="photo-caption" name="caption" type="text" maxLength={MAX_CAPTION_LENGTH} />
        <FieldDescription>{t("captionHint")}</FieldDescription>
      </Field>
      <FormError
        namespace="projectDetailPage.photos.errors"
        error={tooLarge ? "file_too_large" : error}
      />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending || tooLarge}>
          {pending ? t("uploading") : t("submit")}
        </Button>
      </FormActions>
    </form>
  );
}
