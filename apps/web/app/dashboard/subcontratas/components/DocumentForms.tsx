"use client";

import { useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { MAX_DOCUMENT_BYTES, requirement, type SubcontractorError } from "@repo/core/contract";
import FormError from "../../components/FormError";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRequirementBasis } from "./display";

/** Presentational: upload a new version of a document (shown in a modal). */
export function UploadDocumentForm({
  requirementId,
  hidden,
  action,
  pending,
  error,
  onCancel,
}: {
  requirementId: string;
  /** Sent with the file: requirementId, workerId, projectId. */
  hidden: Record<string, string>;
  action: (formData: FormData) => void;
  pending: boolean;
  error?: SubcontractorError;
  onCancel: () => void;
}) {
  const t = useTranslations("subcontractors.documents");
  const basis = useRequirementBasis();
  // Checked here too so an oversized file fails before it is sent.
  const [tooLarge, setTooLarge] = useState(false);
  const expires = requirement(requirementId)?.validityMonths;

  return (
    <form action={action} className="flex flex-col gap-3">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Field>
        <Label htmlFor="subcontractor-file">{t("file")}</Label>
        <Input
          id="subcontractor-file"
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          required
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            setTooLarge(!!file && file.size > MAX_DOCUMENT_BYTES);
          }}
        />
        <FieldDescription>{t("fileHint")}</FieldDescription>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <Label htmlFor="subcontractor-issued">{t("issuedAt")}</Label>
          <Input id="subcontractor-issued" name="issuedAt" type="date" />
        </Field>
        <Field>
          <Label htmlFor="subcontractor-expires">{t("expiresAt")}</Label>
          <Input id="subcontractor-expires" name="expiresAt" type="date" />
        </Field>
      </div>
      <FieldDescription>
        {expires ? t("expiresHint", { validity: basis(requirementId) }) : t("expiresHintNone")}
      </FieldDescription>
      <FormError namespace="subcontractors.errors" error={tooLarge ? "file_too_large" : error} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending || tooLarge}>
          {pending ? t("uploading") : t("upload")}
        </Button>
      </FormActions>
    </form>
  );
}

/** Presentational: a required reason (rejecting a version, a document that doesn't apply). */
export function ReasonForm({
  label,
  hint,
  submitLabel,
  action,
  pending,
  error,
  onCancel,
}: {
  label: string;
  hint?: string;
  submitLabel: string;
  action: (formData: FormData) => void;
  pending: boolean;
  error?: SubcontractorError;
  onCancel: () => void;
}) {
  const t = useTranslations("subcontractors.documents");
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field>
        <Label htmlFor="subcontractor-reason">{label}</Label>
        <Textarea id="subcontractor-reason" name="reason" required maxLength={200} />
        {hint && <FieldDescription>{hint}</FieldDescription>}
      </Field>
      <FormError namespace="subcontractors.errors" error={error} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : submitLabel}
        </Button>
      </FormActions>
    </form>
  );
}
