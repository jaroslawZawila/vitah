"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import type { PurchaseOrderDocument } from "@repo/core/contract";
import { todayInSpain } from "@repo/core/obra-calc";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FormError from "../../../../components/FormError";
import FileSlot from "../../../../subcontratas/empresas/nueva/steps/FileSlot";
import { usePurchaseFormat } from "./format";

// Presentational: an order's documents (the order, the signed contract, its
// annexes, the offer…), each in versions. The container (OrderScreen) runs
// the actions.

/** A timestamp's day in Spain. */
const day = (iso: string) => todayInSpain(new Date(iso));

/** Which form is open: a new document, or a new version of one. */
type Open = { kind: "document" } | { kind: "version"; documentId: string } | null;

/** A PDF, a note and (for a new document) its name; `done` closes it once saved. */
function UploadForm({
  label,
  withTitle,
  pending,
  error,
  onSave,
  onCancel,
}: {
  label: string;
  withTitle: boolean;
  pending: boolean;
  error?: string;
  onSave: (values: { title: string; file: File; note: string }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("purchasing.order.documents");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  return (
    <form
      aria-label={label}
      className="flex flex-col gap-3 rounded-xl border bg-raise p-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (file && (!withTitle || title.trim())) onSave({ title: title.trim(), file, note: note.trim() });
      }}
    >
      {withTitle && (
        <Field>
          <Label htmlFor="document-title">{t("titleLabel")}</Label>
          <Input id="document-title" value={title} maxLength={200} placeholder={t("titlePlaceholder")} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      )}
      <Field>
        <Label htmlFor="document-file">{t("file")}</Label>
        <FileSlot
          id="document-file"
          label={t("chooseFile")}
          file={file}
          onChange={(picked) => {
            setFile(picked);
            // A new document is named after its file until the user says otherwise.
            if (withTitle && picked && !title.trim()) setTitle(picked.name.replace(/\.pdf$/i, "").slice(0, 200));
          }}
          namespace="purchasing.order.documents"
          errorNamespace="purchasing.errors"
        />
      </Field>
      {!withTitle && (
        <Field>
          <Label htmlFor="document-note">{t("note")}</Label>
          <Input id="document-note" value={note} maxLength={300} placeholder={t("notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}
      <FormError namespace="purchasing.errors" error={error} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending || !file || (withTitle && !title.trim())}>
          {pending ? t("saving") : t("save")}
        </Button>
      </FormActions>
    </form>
  );
}

/** The order's documents, oldest first, each with its current version and the ones it replaced. */
export function OrderDocuments({
  documents,
  documentUrl,
  canManage,
  pending,
  error,
  onAdd,
  onAddVersion,
  onRemove,
  onDismiss,
}: {
  documents: PurchaseOrderDocument[];
  documentUrl: (documentId: string, versionId?: string) => string;
  canManage: boolean;
  pending: boolean;
  error?: string;
  /** `done` closes the form once it is in. */
  onAdd: (values: { title: string; file: File }, done: () => void) => void;
  onAddVersion: (documentId: string, values: { file: File; note: string }, done: () => void) => void;
  onRemove: (document: PurchaseOrderDocument) => void;
  /** Forgets the last action's error: a form opens or closes. */
  onDismiss: () => void;
}) {
  const t = useTranslations("purchasing.order.documents");
  const f = usePurchaseFormat();
  const [open, setOpenForm] = useState<Open>(null);
  const setOpen = (next: Open) => {
    onDismiss();
    setOpenForm(next);
  };
  const close = () => setOpen(null);
  return (
    <section className={cardVariants()} aria-labelledby="order-documents-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="order-documents-title" className="text-[22px]">
          {t("title")} <span className="num text-[16px] text-muted-foreground">{documents.length}</span>
        </h2>
        {canManage && open?.kind !== "document" && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen({ kind: "document" })}>
            {t("add")}
          </Button>
        )}
      </div>
      {open?.kind === "document" && (
        <UploadForm
          label={t("add")}
          withTitle
          pending={pending}
          error={error}
          onSave={({ title, file }) => onAdd({ title, file }, close)}
          onCancel={close}
        />
      )}
      {documents.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {documents.map((document) => {
            const [current, ...older] = document.versions;
            return (
              <li key={document.id} className="flex flex-col gap-1.5 border-b py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <b className="min-w-0 text-[13.5px] [overflow-wrap:anywhere]">{document.title}</b>
                  {current && (
                    <span className="rounded-full bg-raise px-2 py-px text-[11.5px] font-semibold">{t("current", { version: current.version })}</span>
                  )}
                  {canManage && (
                    <span className="ml-auto flex gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen({ kind: "version", documentId: document.id })}>
                        {t("newVersion")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost-destructive"
                        size="sm"
                        disabled={pending}
                        aria-label={t("removeOf", { title: document.title })}
                        onClick={() => onRemove(document)}
                      >
                        {t("remove")}
                      </Button>
                    </span>
                  )}
                </div>
                {current && (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                    <a href={documentUrl(document.id)} download className="inline-flex items-center gap-1.5 font-medium text-brand-ink hover:text-primary">
                      <FileText aria-hidden className="size-4 flex-none" />
                      {current.filename}
                    </a>
                    <span className="text-[12px] text-muted-foreground">
                      {f.shortDay(day(current.at))} · {f.fileSize(current.sizeBytes)}
                      {current.by && ` · ${current.by}`}
                      {current.note && ` · «${current.note}»`}
                    </span>
                  </span>
                )}
                {older.length > 0 && (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0 pl-5 text-[12.5px] text-muted-foreground">
                    {older.map((version) => (
                      <li key={version.id} className="flex flex-wrap items-center gap-x-2">
                        <a href={documentUrl(document.id, version.id)} download className="inline-flex items-center gap-1 hover:text-foreground">
                          <FileText aria-hidden className="size-3.5 flex-none" />
                          {t("version", { version: version.version })} · {version.filename}
                        </a>
                        <span>
                          {f.shortDay(day(version.at))}
                          {version.note && ` · «${version.note}»`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {open?.kind === "version" && open.documentId === document.id && (
                  <UploadForm
                    label={t("versionOf", { title: document.title })}
                    withTitle={false}
                    pending={pending}
                    error={error}
                    onSave={({ file, note }) => onAddVersion(document.id, { file, note }, close)}
                    onCancel={close}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {/* An open form shows its own error; a removal's shows here. */}
      {!open && <FormError namespace="purchasing.errors" error={error} />}
      <p className="m-0 text-[12.5px] text-muted-foreground">{t("hint")}</p>
    </section>
  );
}
