"use client";

// Container for a hito (P-Hito): the only part that knows about server
// actions. The views in ../../components/obra take props only.

import Link from "next/link";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import type { Hito, HitoFileKind, ProjectPhoto } from "@repo/core/contract";
import {
  addCheckAction,
  cancelPaymentAction,
  deleteCheckAction,
  registerPaymentAction,
  removeHitoFileAction,
  setActaPhotosAction,
  updateCheckAction,
  updateHitoAction,
  uploadHitoFileAction
} from "../../../../../actions/obra";
import type { ObraState } from "../../../../../actions/run";
import FormError from "../../components/FormError";
import Modal from "../../components/Modal";
import FieldsForm from "../../components/obra/FieldsForm";
import { useObraFormat } from "../../components/obra/format";
import {
  HitoConditions,
  HitoFileCard,
  HitoFileForm,
  HitoNotes,
  HitoSteps,
  PaymentCard,
  PhotoPicker,
} from "../../components/obra/HitoParts";
import styles from "../../components/obra/obra.module.css";
import PhotoStrip from "../../components/obra/PhotoStrip";
import { useObraAction } from "../../components/obra/useObraAction";
import { projectPhotoUrl } from "../../components/photoUrl";
import TabHeader from "../../components/TabHeader";

type Dialog = "photos" | "edit" | HitoFileKind;

/** A payment hito: its conditions, the signed acta, the invoice and the payment. */
export default function HitoScreen({
  projectId,
  projectRef,
  hito,
  photos,
  canManage,
}: {
  projectId: string;
  projectRef: string;
  hito: Hito;
  /** The project's photos, to pick the acta's from. */
  photos: ProjectPhoto[];
  canManage: boolean;
}) {
  const t = useTranslations("obra.hito");
  const f = useObraFormat();
  const { state, pending, run, confirmThen, reset } = useObraAction();
  const [dialog, setDialogState] = useState<Dialog | null>(null);
  const close = () => setDialogState(null);
  /** Opens a dialog on a clean slate: no error from an earlier action. */
  const setDialog = (next: Dialog) => {
    reset();
    setDialogState(next);
  };
  const fileUrl = (kind: HitoFileKind) => `/api/v1/projects/${projectId}/hitos/${hito.id}/files/${kind}`;
  const thumbUrl = (photo: ProjectPhoto) => projectPhotoUrl(projectId, photo.id, "thumb");
  const actaPhotos = photos.filter((p) => hito.photoIds.includes(p.id));
  /** Staff-only callbacks: undefined for viewers, so the views stay read-only. */
  const editor = <T,>(fn: T) => (canManage ? fn : undefined);
  const removeFile = (kind: HitoFileKind) =>
    editor(() => confirmThen(t("confirmRemove"), () => removeHitoFileAction(projectId, hito.id, kind)));

  const titles: Record<Dialog, string> = {
    photos: t("pickerTitle"),
    edit: t("editTitle"),
    acta: t("uploadActa"),
    invoice: t("uploadInvoice"),
  };

  return (
    <div className={styles.stack}>
      <Link href={`/dashboard/projects/${projectId}/payments`} className={styles.link}>
        ← {t("back")}
      </Link>
      <TabHeader
        projectRef={t("label", { ref: projectRef, code: hito.code, pct: f.share(hito.pctBp) })}
        title={hito.name}
        summary={t("summary", {
          moment: hito.billingMoment,
          amount: f.money(hito.amountCents),
          vat: f.money(hito.vatCents),
          total: f.money(hito.totalCents),
        })}
        action={
          canManage && (
            <button type="button" className={styles.button} onClick={() => setDialog("edit")}>
              {t("edit")}
            </button>
          )
        }
      />
      <FormError namespace="obra.errors" error={state?.error} />
      <HitoSteps hito={hito} />

      <div className={styles.split}>
        <div className={styles.stack}>
          <HitoConditions
            hito={hito}
            onToggle={editor((id: string, done: boolean) => run(() => updateCheckAction(projectId, id, { done })))}
            onAdd={editor((label: string) => run(() => addCheckAction(projectId, hito.id, label)))}
            onDelete={editor((id: string) => run(() => deleteCheckAction(projectId, id)))}
          />
          <HitoFileCard
            title={t("actaTitle")}
            href={hito.actaSignedOn && fileUrl("acta")}
            fileName={t("actaFile", { code: hito.code })}
            detail={hito.actaSignedOn ? t("actaSigned", { date: f.date(hito.actaSignedOn) }) : ""}
            empty={t("noActa")}
            uploadLabel={t("uploadActa")}
            onUpload={editor(() => setDialog("acta"))}
            onRemove={removeFile("acta")}
          >
            {canManage && (
              <button type="button" className={styles.button} onClick={() => setDialog("photos")}>
                {t("choosePhotos")}
              </button>
            )}
            {actaPhotos.length > 0 ? (
              <PhotoStrip photos={actaPhotos} thumbUrl={thumbUrl} />
            ) : (
              <span className={styles.muted}>{t("noActaPhotos")}</span>
            )}
          </HitoFileCard>
          <HitoFileCard
            title={t("invoiceTitle")}
            href={hito.invoicedOn && fileUrl("invoice")}
            fileName={t("invoiceFile", { code: hito.code })}
            detail={hito.invoicedOn ? t("invoiceIssued", { date: f.date(hito.invoicedOn), amount: f.money(hito.totalCents) }) : ""}
            empty={t("noInvoice")}
            uploadLabel={t("uploadInvoice")}
            onUpload={editor(() => setDialog("invoice"))}
            onRemove={removeFile("invoice")}
          >
            {hito.dueOn && <span className={styles.muted}>{t("dueNote", { date: f.date(hito.dueOn) })}</span>}
          </HitoFileCard>
        </div>

        <aside className={styles.aside}>
          <PaymentCard
            hito={hito}
            pending={pending}
            onPay={editor((paidOn: string, amount: string) =>
              run(() =>
                registerPaymentAction(projectId, hito.id, {
                  paidOn,
                  // Left empty: the hito's total, which core defaults to.
                  amountCents: amount.trim() ? f.hundredths(amount) : undefined,
                }),
              ),
            )}
            onCancel={editor(() => confirmThen(t("confirmCancelPayment"), () => cancelPaymentAction(projectId, hito.id)))}
          />
          <HitoNotes hito={hito} />
        </aside>
      </div>

      {dialog && (
        <Modal open onOpenChange={(isOpen) => !isOpen && close()} title={titles[dialog]}>
          {dialog === "photos" && (
            <PhotoPicker
              photos={photos}
              initial={hito.photoIds}
              thumbUrl={thumbUrl}
              pending={pending}
              onCancel={close}
              onSave={(ids) => run(() => setActaPhotosAction(projectId, hito.id, ids), close)}
            />
          )}
          {(dialog === "acta" || dialog === "invoice") && (
            <UploadFile projectId={projectId} hitoId={hito.id} kind={dialog} onDone={close} />
          )}
          {dialog === "edit" && (
            <FieldsForm
              pending={pending}
              error={state?.error}
              onCancel={close}
              fields={[
                { name: "name", label: t("name"), defaultValue: hito.name, required: true },
                { name: "pct", label: t("pct"), defaultValue: f.pctInput(hito.pctBp), inputMode: "decimal", required: true },
                { name: "scope", label: t("scope"), multiline: true, defaultValue: hito.scope },
                { name: "billingMoment", label: t("moment"), defaultValue: hito.billingMoment },
              ]}
              onSubmit={({ pct, ...values }) =>
                run(() => updateHitoAction(projectId, hito.id, { ...values, pctBp: f.hundredths(pct ?? "") }), close)
              }
            />
          )}
        </Modal>
      )}
    </div>
  );
}

/** Mounted only while the modal is open, so each upload starts afresh. */
function UploadFile({
  projectId,
  hitoId,
  kind,
  onDone,
}: {
  projectId: string;
  hitoId: string;
  kind: HitoFileKind;
  onDone: () => void;
}) {
  const [state, upload, uploading] = useActionState(
    async (prev: ObraState, formData: FormData) => {
      const result = await uploadHitoFileAction(projectId, hitoId, kind, prev, formData);
      if (result?.success) onDone();
      return result;
    },
    null,
  );
  return (
    <HitoFileForm kind={kind} action={upload} pending={uploading} error={state?.error} onCancel={onDone} />
  );
}
