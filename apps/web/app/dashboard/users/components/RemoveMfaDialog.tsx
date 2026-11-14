"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormActions } from "@/components/ui/field";
import FormError from "../../components/FormError";

/**
 * Presentational: an admin confirms removing the two-step verification of the
 * staff user `name` (open while there is one), e.g. after a lost phone.
 * `onConfirm` does it; `onDone` when it is done.
 */
export default function RemoveMfaDialog({
  name,
  onConfirm,
  onDone,
  onClose,
}: {
  /** Whose; null closes the dialog. */
  name: string | null;
  onConfirm: () => Promise<{ error?: string }>;
  onDone: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("usersPage.removeTwoStep");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setError(null);
    onClose();
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await onConfirm();
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <Dialog open={name !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent closeLabel={t("close")}>
        <DialogHeader>
          <DialogTitle>{t("title", { name: name ?? "" })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <FormError namespace="usersPage.errors" error={error} />
        <FormActions>
          <Button type="button" variant="outline" onClick={close}>
            {t("cancel")}
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
            {pending ? t("confirming") : t("confirm")}
          </Button>
        </FormActions>
      </DialogContent>
    </Dialog>
  );
}
