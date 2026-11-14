"use client";

import { useTranslations } from "next-intl";
import type { DeletedItem } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormActions } from "@/components/ui/field";
import FormError from "../../components/FormError";
import { useDeletedText } from "./text";

/**
 * Presentational: asks before restoring `item` (open while there is one),
 * saying what coming back means for its kind. `error` is the code the last
 * try answered; `pending` while it runs.
 */
export default function RestoreDialog({
  item,
  error,
  pending,
  onConfirm,
  onClose,
}: {
  /** What to restore; null closes the dialog. */
  item: DeletedItem | null;
  error: string | null;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("deletedPage.confirm");
  const text = useDeletedText();

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent closeLabel={t("close")}>
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="break-words">{t("title", { item: text.title(item) })}</DialogTitle>
              <DialogDescription>{t(`description.${item.kind}`)}</DialogDescription>
            </DialogHeader>
            <FormError namespace="deletedPage.errors" error={error} />
            <FormActions>
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button type="button" onClick={onConfirm} disabled={pending}>
                {pending ? t("restoring") : t("confirm")}
              </Button>
            </FormActions>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
