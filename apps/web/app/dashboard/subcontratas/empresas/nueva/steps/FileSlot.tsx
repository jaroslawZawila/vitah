"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, X } from "lucide-react";
import { MAX_DOCUMENT_BYTES } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FormError from "../../../../components/FormError";

/**
 * Presentational: picks one PDF and keeps it until the flow submits. Files
 * over 4 MB are refused here, before anything is sent. `namespace` holds its
 * `removeFile` ({name}) line and `errorNamespace` the `file_too_large` one.
 */
export default function FileSlot({
  id,
  label,
  file,
  onChange,
  namespace = "subcontractors.wizard.documents",
  errorNamespace = "subcontractors.errors",
}: {
  id: string;
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  namespace?: string;
  errorNamespace?: string;
}) {
  const t = useTranslations(namespace);
  const [tooLarge, setTooLarge] = useState(false);

  if (file) {
    return (
      <div className="flex min-h-11 items-center gap-2 rounded-md border bg-raise px-2.5 text-[13px] lg:min-h-9">
        <FileText aria-hidden className="size-4 flex-none text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("removeFile", { name: file.name })} onClick={() => onChange(null)}>
          <X />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Input
        id={id}
        type="file"
        accept="application/pdf,.pdf"
        aria-label={label}
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          const large = !!picked && picked.size > MAX_DOCUMENT_BYTES;
          setTooLarge(large);
          if (picked && !large) onChange(picked);
        }}
      />
      <FormError namespace={errorNamespace} error={tooLarge ? "file_too_large" : undefined} />
    </div>
  );
}
