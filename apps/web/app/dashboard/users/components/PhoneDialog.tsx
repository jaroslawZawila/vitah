"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FormError from "../../components/FormError";

/**
 * Presentational: an admin sets the contact phone of the staff user `user`
 * (open while there is one); blank removes it. `onSubmit` gets the form
 * (`phone`); `onDone` once it was saved.
 */
export default function PhoneDialog({
  user,
  onSubmit,
  onDone,
  onClose,
}: {
  /** Whose phone, and the one they have; null closes the dialog. */
  user: { name: string; phone: string | null } | null;
  onSubmit: (form: FormData) => Promise<{ error?: string }>;
  onDone: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("usersPage.phone");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setError(null);
    onClose();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await onSubmit(form);
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent closeLabel={t("close")}>
        <DialogHeader>
          <DialogTitle>{t("title", { name: user?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field>
            <Label htmlFor="user-phone">{t("label")}</Label>
            <Input
              id="user-phone"
              name="phone"
              type="tel"
              autoComplete="off"
              maxLength={200}
              defaultValue={user?.phone ?? ""}
            />
          </Field>
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
