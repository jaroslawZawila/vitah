"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { isStrongPassword } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormActions } from "@/components/ui/field";
import FormError from "../../components/FormError";
import NewPasswordField from "../../components/NewPasswordField";

/**
 * Presentational: an admin types a new password for the staff user `name`
 * (open while there is one). `onSubmit` gets the form (`password`) once it is
 * within the policy; `onDone` when it was saved. The password is never shown again.
 */
export default function ResetPasswordDialog({
  name,
  onSubmit,
  onDone,
  onClose,
}: {
  /** Whose password; null closes the dialog. */
  name: string | null;
  onSubmit: (form: FormData) => Promise<{ error?: string }>;
  onDone: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("usersPage.resetPassword");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setError(null);
    onClose();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = form.get("password");
    if (typeof password !== "string" || !isStrongPassword(password)) return setError("weak_password");
    setError(null);
    startTransition(async () => {
      const result = await onSubmit(form);
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
        <form onSubmit={submit} className="flex flex-col gap-3">
          <NewPasswordField label={t("password")} />
          <FormError namespace="usersPage.errors" error={error} />
          <FormActions>
            <Button type="button" variant="outline" onClick={close}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
          </FormActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
