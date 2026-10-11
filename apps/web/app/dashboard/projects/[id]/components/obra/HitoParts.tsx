"use client";

// Presentational parts of a hito's page (P-Hito). They take data and
// callbacks only; HitoScreen wires them to the server actions.

import { Check, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  HITO_STATUSES,
  MAX_DOCUMENT_BYTES,
  type Hito,
  type HitoFileKind,
  type ProjectPhoto,
} from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FieldDescription, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import FormError from "../../../../components/FormError";
import { cardHead, checkLabel, checkRow, codeChip, muted } from "./classes";
import { useObraFormat } from "./format";
import PhotoStrip from "./PhotoStrip";
import Stepper from "./Stepper";

/** The steps shown: every status after "pending". */
const STEPS = HITO_STATUSES.slice(1);

/** The hito's way to payment: in progress → ready → signed → invoiced → paid. */
export function HitoSteps({ hito }: { hito: Hito }) {
  const t = useTranslations("obra.hito");
  const f = useObraFormat();
  const reached = STEPS.indexOf(hito.status as (typeof STEPS)[number]);
  const meta: Partial<Record<(typeof STEPS)[number], string | null>> = {
    signed: hito.actaSignedOn && f.date(hito.actaSignedOn),
    invoiced: hito.invoicedOn && f.date(hito.invoicedOn),
    paid: hito.paidOn ? f.date(hito.paidOn) : hito.dueOn && t("stepDue", { date: f.date(hito.dueOn) }),
  };
  return (
    <section className={cardVariants()}>
      <Stepper
        label={t("stepsLabel")}
        steps={STEPS.map((step, index) => ({
          key: step,
          label: t(`steps.${step}`),
          meta: meta[step] ?? undefined,
          state: index <= reached ? "done" : index === reached + 1 ? "current" : "todo",
        }))}
      />
    </section>
  );
}

/** The hito's chapters (from the budget) and its checks, which staff tick. */
export function HitoConditions({
  hito,
  onToggle,
  onAdd,
  onDelete,
}: {
  hito: Hito;
  /** Omitted for read-only users. */
  onToggle?: (checkId: string, done: boolean) => void;
  onAdd?: (label: string) => void;
  onDelete?: (checkId: string) => void;
}) {
  const t = useTranslations("obra.hito");
  const [label, setLabel] = useState("");
  const tick = (met: boolean) => (
    <span
      className={cn(
        "grid size-5 flex-none place-items-center rounded-sm border-[1.5px]",
        met && "border-good bg-good text-card",
      )}
      aria-hidden
    >
      {met && <Check size={13} strokeWidth={3} />}
    </span>
  );

  return (
    <section className={cardVariants()}>
      <h2>{t("conditions")}</h2>
      <p className={muted}>{hito.scope}</p>
      <div>
        {hito.chapters.map((chapter) => (
          <div key={chapter.code} className={checkRow}>
            {tick(chapter.progressPct === 100)}
            <span className={checkLabel}>
              <span className={codeChip}>{chapter.code}</span> {chapter.name}
            </span>
            <span className="num text-muted-foreground">{chapter.progressPct} %</span>
          </div>
        ))}
        {hito.checks.map((check) => (
          <div key={check.id} className={checkRow}>
            <label className={cn(checkLabel, "cursor-pointer")}>
              <input
                type="checkbox"
                className="size-5 flex-none accent-good"
                checked={check.done}
                disabled={!onToggle}
                onChange={(event) => onToggle?.(check.id, event.target.checked)}
              />
              {check.label}
            </label>
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="hover:text-bad"
                aria-label={t("deleteCheck", { label: check.label })}
                onClick={() => onDelete(check.id)}
              >
                <Trash2 aria-hidden />
              </Button>
            )}
          </div>
        ))}
        <div className={checkRow}>
          {tick(hito.photoIds.length > 0)}
          <span className={checkLabel}>{t("photosChosen")}</span>
          <span className="num text-muted-foreground">{hito.photoIds.length}</span>
        </div>
      </div>
      {onAdd && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!label.trim()) return;
            onAdd(label.trim());
            setLabel("");
          }}
        >
          <Input
            className="flex-[1_1_200px]"
            aria-label={t("newCheck")}
            placeholder={t("newCheck")}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <Button type="submit" variant="outline">
            {t("addCheck")}
          </Button>
        </form>
      )}
    </section>
  );
}

/**
 * A card for one of the hito's PDFs (the signed acta or the invoice): the file
 * as a download row, or a note that it isn't there yet.
 */
export function HitoFileCard({
  title,
  href,
  fileName,
  detail,
  empty,
  onUpload,
  uploadLabel,
  onRemove,
  children,
}: {
  title: string;
  /** Null until the file is uploaded. */
  href: string | null;
  fileName: string;
  detail: string;
  empty: string;
  /** Omitted for read-only users. */
  onUpload?: () => void;
  uploadLabel: string;
  onRemove?: () => void;
  children?: React.ReactNode;
}) {
  const t = useTranslations("obra.hito");
  return (
    <section className={cardVariants()}>
      <div className={cn(cardHead, "items-center")}>
        <h2>{title}</h2>
        {onUpload && !href && (
          <Button type="button" variant="outline" size="sm" onClick={onUpload}>
            {uploadLabel}
          </Button>
        )}
      </div>
      {children}
      {href ? (
        <div className="grid grid-flow-col auto-cols-auto grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b py-2.5 text-[13.5px] last:border-b-0">
          <span
            className="grid h-[42px] w-9 place-items-center rounded-sm border bg-raise text-[9.5px] font-semibold text-brand-ink"
            aria-hidden
          >
            PDF
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <a href={href} target="_blank" rel="noreferrer" className="font-medium text-info [overflow-wrap:anywhere] hover:underline">
              {fileName}
            </a>
            <span className="text-xs text-muted-foreground">{detail}</span>
          </div>
          {onUpload && (
            <Button type="button" variant="ghost" size="sm" onClick={onUpload}>
              {t("replace")}
            </Button>
          )}
          {onRemove && (
            <Button type="button" variant="ghost-destructive" size="sm" onClick={onRemove}>
              {t("remove")}
            </Button>
          )}
        </div>
      ) : (
        <span className={muted}>{empty}</span>
      )}
    </section>
  );
}

/** Upload the signed acta or the invoice (shown in a modal). */
export function HitoFileForm({
  kind,
  action,
  pending,
  error,
  onCancel,
}: {
  kind: HitoFileKind;
  action: (formData: FormData) => void;
  pending: boolean;
  error?: string;
  onCancel: () => void;
}) {
  const t = useTranslations("obra.hito");
  const [tooLarge, setTooLarge] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field>
        <Label htmlFor="hito-file">{t("file")}</Label>
        <Input
          id="hito-file"
          name="file"
          type="file"
          accept="application/pdf"
          required
          onChange={(event) => setTooLarge((event.target.files?.[0]?.size ?? 0) > MAX_DOCUMENT_BYTES)}
        />
        <FieldDescription>{t("fileHint")}</FieldDescription>
      </Field>
      <Field>
        <Label htmlFor="hito-date">{kind === "acta" ? t("signedOn") : t("invoiceDate")}</Label>
        {/* The acta's date is when it was signed; an invoice defaults to today. */}
        <Input id="hito-date" name="date" type="date" required={kind === "acta"} />
      </Field>
      <FormError namespace="obra.errors" error={tooLarge ? "file_too_large" : error} />
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

/** Pick the project photos of the acta fotográfica (shown in a modal). */
export function PhotoPicker({
  photos,
  initial,
  thumbUrl,
  pending,
  onSave,
  onCancel,
}: {
  photos: ProjectPhoto[];
  initial: string[];
  thumbUrl: (photo: ProjectPhoto) => string;
  pending: boolean;
  onSave: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("obra.hito");
  const [selected, setSelected] = useState(() => new Set(initial));
  if (photos.length === 0) return <p className={muted}>{t("pickerEmpty")}</p>;

  function toggle(photo: ProjectPhoto) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(photo.id)) next.add(photo.id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PhotoStrip photos={photos} thumbUrl={thumbUrl} selected={selected} onToggle={toggle} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button
          type="button"
          disabled={pending}
          onClick={() => onSave(photos.filter((p) => selected.has(p.id)).map((p) => p.id))}
        >
          {t("pickerSave")}
        </Button>
      </FormActions>
    </div>
  );
}

/** Record the payment, or show it with an undo. */
export function PaymentCard({
  hito,
  onPay,
  onCancel,
  pending,
}: {
  hito: Hito;
  /** Omitted for read-only users. */
  onPay?: (paidOn: string, amount: string) => void;
  onCancel?: () => void;
  pending: boolean;
}) {
  const t = useTranslations("obra.hito");
  const f = useObraFormat();
  return (
    <section id="payment" className={cardVariants()}>
      <span className="eyebrow">{t("paymentTitle")}</span>
      {hito.paidOn ? (
        <>
          <span className="text-[13.5px] font-semibold text-good">
            {t("paid", { date: f.date(hito.paidOn), amount: f.money(hito.paidAmountCents ?? 0) })}
          </span>
          {onCancel && (
            <Button type="button" variant="destructive" className="w-fit" onClick={onCancel} disabled={pending}>
              {t("cancelPayment")}
            </Button>
          )}
        </>
      ) : onPay ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onPay(String(data.get("paidOn")), String(data.get("amount")));
          }}
        >
          <Field>
            <Label htmlFor="paid-on">{t("paidOn")}</Label>
            <Input id="paid-on" name="paidOn" type="date" required />
          </Field>
          <Field>
            <Label htmlFor="paid-amount">{t("paidAmount")}</Label>
            <Input id="paid-amount" name="amount" inputMode="decimal" defaultValue={f.decimal(hito.totalCents / 100)} />
          </Field>
          <Button type="submit" disabled={pending}>
            {t("registerPayment")}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

/** What the client sees of the hito, and the contract terms around payment. */
export function HitoNotes({ hito }: { hito: Hito }) {
  const t = useTranslations("obra.hito");
  // A hito nobody has started reads as "in progress" to the client too.
  const status = hito.status === "pending" ? "active" : hito.status;
  return (
    <>
      <section className={cn(cardVariants(), "gap-2")}>
        <span className="eyebrow">{t("appTitle")}</span>
        <span className={muted}>{t("appText", { status: t(`steps.${status}`) })}</span>
      </section>
      <section className={cn(cardVariants(), "gap-2")}>
        <span className="eyebrow">{t("contractTitle")}</span>
        <span className={muted}>{t("contractText")}</span>
      </section>
    </>
  );
}
