"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { loginAction } from "../actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const t = useTranslations("login");
  const [state, formAction, isPending] = useActionState(loginAction, null);

  return (
    <form action={formAction} className="mt-12 flex w-full max-w-[380px] flex-col gap-5">
      <Field>
        <Label htmlFor="email" className="tracking-[0.08em] uppercase">
          {t("emailLabel")}
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          placeholder={t("emailPlaceholder")}
          className="h-12 px-4 text-[15px]"
          autoComplete="email"
        />
      </Field>

      <Field>
        <Label htmlFor="password" className="tracking-[0.08em] uppercase">
          {t("passwordLabel")}
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          placeholder={t("passwordPlaceholder")}
          className="h-12 px-4 text-[15px]"
          autoComplete="current-password"
        />
      </Field>

      <Button type="submit" disabled={isPending} size="lg" className="mt-1 h-12 bg-verde-oliva text-white">
        {isPending ? t("submitting") : t("submit")}
      </Button>

      {state?.error && (
        <FormMessage className="text-center">
          {t(state.error === "too_many_attempts" ? "tooManyAttempts" : "error")}
        </FormMessage>
      )}
    </form>
  );
}
