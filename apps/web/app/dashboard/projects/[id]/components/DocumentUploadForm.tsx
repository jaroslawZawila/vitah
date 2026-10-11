"use client";

import { useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { DOCUMENT_CATEGORIES, MAX_DOCUMENT_BYTES, type DocumentError } from "@repo/core/contract";
import FormError from "../../../components/FormError";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/** Presentational: upload a PDF with a title and category (shown in a modal). */
export default function DocumentUploadForm({
  action,
  pending,
  error,
  onCancel,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  error?: DocumentError;
  onCancel: () => void;
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
    <form action={action} className="flex flex-col gap-3">
      <Field>
        <Label htmlFor="document-file">{t("file")}</Label>
        <Input
          id="document-file"
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          required
          onChange={handleFile}
        />
        <FieldDescription>{t("fileHint")}</FieldDescription>
      </Field>
      <Field>
        <Label htmlFor="document-title">{t("documentTitle")}</Label>
        <Input id="document-title" name="title" type="text" required maxLength={200} />
      </Field>
      <Field>
        <Label htmlFor="document-category">{t("category")}</Label>
        <NativeSelect
          id="document-category"
          name="category"
          required
          defaultValue=""
        >
          <NativeSelectOption value="" disabled>
            {t("chooseCategory")}
          </NativeSelectOption>
          {DOCUMENT_CATEGORIES.map((category) => (
            <NativeSelectOption key={category} value={category}>
              {t(`categories.${category}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <FormError
        namespace="projectDetailPage.documents.errors"
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
