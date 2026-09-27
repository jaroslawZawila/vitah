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
import formStyles from "../cardForm.module.css";
import docStyles from "../documents.module.css";
import FormError from "../FormError";
import { useObraFormat } from "./format";
import styles from "./obra.module.css";
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
    <section className={styles.card}>
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
    <span className={styles.checkMark} aria-hidden>
      {met && <Check size={18} />}
    </span>
  );

  return (
    <section className={styles.cardTight}>
      <h2 className={styles.cardTitle}>{t("conditions")}</h2>
      <p className={styles.muted}>{hito.scope}</p>
      <div>
        {hito.chapters.map((chapter) => (
          <div key={chapter.code} className={styles.checkRow}>
            {tick(chapter.progressPct === 100)}
            <span className={styles.checkLabel}>
              <span className={styles.code}>{chapter.code}</span> {chapter.name}
            </span>
            <span className={`${styles.num} ${styles.muted}`}>{chapter.progressPct} %</span>
          </div>
        ))}
        {hito.checks.map((check) => (
          <div key={check.id} className={styles.checkRow}>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={check.done}
                disabled={!onToggle}
                onChange={(event) => onToggle?.(check.id, event.target.checked)}
              />
              {check.label}
            </label>
            {onDelete && (
              <button
                type="button"
                className={styles.dangerText}
                aria-label={t("deleteCheck", { label: check.label })}
                onClick={() => onDelete(check.id)}
              >
                <Trash2 size={14} aria-hidden />
              </button>
            )}
          </div>
        ))}
        <div className={styles.checkRow}>
          {tick(hito.photoIds.length > 0)}
          <span className={styles.checkLabel}>{t("photosChosen")}</span>
          <span className={`${styles.num} ${styles.muted}`}>{hito.photoIds.length}</span>
        </div>
      </div>
      {onAdd && (
        <form
          className={styles.buttons}
          onSubmit={(event) => {
            event.preventDefault();
            if (!label.trim()) return;
            onAdd(label.trim());
            setLabel("");
          }}
        >
          <input
            className={styles.inputText}
            style={{ flex: 1 }}
            aria-label={t("newCheck")}
            placeholder={t("newCheck")}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <button type="submit" className={styles.button}>
            {t("addCheck")}
          </button>
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
    <section className={styles.cardSnug}>
      <div className={styles.cardHeadFlush}>
        <h2 className={styles.cardTitle}>{title}</h2>
        {onUpload && !href && (
          <button type="button" className={styles.button} onClick={onUpload}>
            {uploadLabel}
          </button>
        )}
      </div>
      {children}
      {href ? (
        <div className={docStyles.row}>
          <span className={docStyles.fileType} aria-hidden>
            PDF
          </span>
          <div className={docStyles.details}>
            <a href={href} target="_blank" rel="noreferrer" className={docStyles.title}>
              {fileName}
            </a>
            <span className={docStyles.meta}>{detail}</span>
          </div>
          {onUpload && (
            <button type="button" className={styles.textButton} onClick={onUpload}>
              {t("replace")}
            </button>
          )}
          {onRemove && (
            <button type="button" className={styles.dangerText} onClick={onRemove}>
              {t("remove")}
            </button>
          )}
        </div>
      ) : (
        <span className={styles.muted}>{empty}</span>
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
    <form action={action} className={formStyles.form}>
      <div className={formStyles.field}>
        <label htmlFor="hito-file">{t("file")}</label>
        <input
          id="hito-file"
          name="file"
          type="file"
          accept="application/pdf"
          required
          onChange={(event) => setTooLarge((event.target.files?.[0]?.size ?? 0) > MAX_DOCUMENT_BYTES)}
        />
        <span className={formStyles.hint}>{t("fileHint")}</span>
      </div>
      <div className={formStyles.field}>
        <label htmlFor="hito-date">{kind === "acta" ? t("signedOn") : t("invoiceDate")}</label>
        {/* The acta's date is when it was signed; an invoice defaults to today. */}
        <input id="hito-date" name="date" type="date" required={kind === "acta"} />
      </div>
      <FormError namespace="obra.errors" error={tooLarge ? "file_too_large" : error} />
      <div className={formStyles.actions}>
        <button type="button" className={formStyles.secondary} onClick={onCancel}>
          {t("cancel")}
        </button>
        <button type="submit" className={formStyles.primary} disabled={pending || tooLarge}>
          {pending ? t("uploading") : t("upload")}
        </button>
      </div>
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
  if (photos.length === 0) return <p className={styles.muted}>{t("pickerEmpty")}</p>;

  function toggle(photo: ProjectPhoto) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(photo.id)) next.add(photo.id);
      return next;
    });
  }

  return (
    <div className={styles.stack}>
      <PhotoStrip photos={photos} thumbUrl={thumbUrl} selected={selected} onToggle={toggle} />
      <div className={formStyles.actions}>
        <button type="button" className={formStyles.secondary} onClick={onCancel}>
          {t("cancel")}
        </button>
        <button
          type="button"
          className={formStyles.primary}
          disabled={pending}
          onClick={() => onSave(photos.filter((p) => selected.has(p.id)).map((p) => p.id))}
        >
          {t("pickerSave")}
        </button>
      </div>
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
    <section id="payment" className={styles.cardSnug}>
      <span className={styles.label}>{t("paymentTitle")}</span>
      {hito.paidOn ? (
        <>
          <span className={styles.good}>
            {t("paid", { date: f.date(hito.paidOn), amount: f.money(hito.paidAmountCents ?? 0) })}
          </span>
          {onCancel && (
            <button type="button" className={styles.buttonDanger} onClick={onCancel} disabled={pending}>
              {t("cancelPayment")}
            </button>
          )}
        </>
      ) : onPay ? (
        <form
          className={formStyles.form}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onPay(String(data.get("paidOn")), String(data.get("amount")));
          }}
        >
          <div className={formStyles.field}>
            <label htmlFor="paid-on">{t("paidOn")}</label>
            <input id="paid-on" name="paidOn" type="date" required />
          </div>
          <div className={formStyles.field}>
            <label htmlFor="paid-amount">{t("paidAmount")}</label>
            <input id="paid-amount" name="amount" inputMode="decimal" defaultValue={f.decimal(hito.totalCents / 100)} />
          </div>
          <button type="submit" className={formStyles.primary} disabled={pending}>
            {t("registerPayment")}
          </button>
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
      <section className={styles.cardTight}>
        <span className={styles.label}>{t("appTitle")}</span>
        <span className={styles.muted}>{t("appText", { status: t(`steps.${status}`) })}</span>
      </section>
      <section className={styles.cardTight}>
        <span className={styles.label}>{t("contractTitle")}</span>
        <span className={styles.muted}>{t("contractText")}</span>
      </section>
    </>
  );
}
