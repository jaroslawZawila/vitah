"use client";

import Link from "next/link";
import { useId, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { isStrongPassword } from "@repo/core/contract";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FormActions, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FormError from "./FormError";
import NewPasswordField from "./NewPasswordField";

/** What changing the password answered: an error code, or done (and whether this browser was signed out). */
export type PasswordChangeResult = { error?: string; success?: boolean; signedOut?: boolean };

/**
 * Presentational: the signed-in user changes their own password (current, new,
 * repeated). `onSubmit` gets the form (`currentPassword`, `newPassword`) once
 * the new one is within the policy and typed the same twice.
 */
export default function ChangePasswordDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: FormData) => Promise<PasswordChangeResult>;
}) {
  const t = useTranslations("account.changePassword");
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"changed" | "signedOut" | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = form.get("newPassword");
    const problem =
      typeof next !== "string" || !isStrongPassword(next)
        ? "weak_password"
        : next !== form.get("repeatPassword")
          ? "mismatch"
          : null;
    setError(problem);
    if (problem) return;
    form.delete("repeatPassword");
    startTransition(async () => {
      const result = await onSubmit(form);
      if (result.error) setError(result.error);
      else setDone(result.signedOut ? "signedOut" : "changed");
    });
  }

  function change(next: boolean) {
    // Closed: nothing typed, and no old outcome, is left for the next time.
    if (!next) {
      setError(null);
      setDone(null);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent closeLabel={t("close")}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {done ? (
          <>
            <FormMessage tone="success" role="status">
              {t(done === "signedOut" ? "signedOut" : "success")}
            </FormMessage>
            <FormActions>
              {done === "signedOut" ? (
                // The session is gone: the login page is the only one left.
                <Link href="/" prefetch={false} className={buttonVariants()}>
                  {t("signIn")}
                </Link>
              ) : (
                <Button type="button" onClick={() => change(false)}>
                  {t("done")}
                </Button>
              )}
            </FormActions>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Field>
              <Label htmlFor={`${id}-current`}>{t("current")}</Label>
              <Input
                id={`${id}-current`}
                name="currentPassword"
                type="password"
                required
                autoComplete="current-password"
              />
            </Field>
            <NewPasswordField label={t("new")} name="newPassword" />
            <Field>
              <Label htmlFor={`${id}-repeat`}>{t("repeat")}</Label>
              <Input
                id={`${id}-repeat`}
                name="repeatPassword"
                type="password"
                required
                autoComplete="new-password"
              />
            </Field>
            <FormError namespace="account.changePassword.errors" error={error} />
            <FormActions>
              <Button type="button" variant="outline" onClick={() => change(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t("saving") : t("save")}
              </Button>
            </FormActions>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
