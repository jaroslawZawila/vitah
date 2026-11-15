"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { loginAction, type LoginError } from "../actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Where the form is: the email and password, or the two-step verification code after them. */
type LoginState = {
  step: "password" | "code";
  error: ShownError | null;
  /** Codes sent so far: each try starts from an empty field. */
  tries: number;
};

/** "Code required" is not an error to show: it is the code step itself. */
type ShownError = Exclude<LoginError, "mfa_required">;

const ERROR_KEY = {
  invalid_credentials: "error",
  too_many_attempts: "tooManyAttempts",
  invalid_code: "invalidCode",
} as const satisfies Record<ShownError, string>;

/**
 * The sign-in form. Email and password first; an account with two-step
 * verification then answers "code required" (only ever to the right
 * password), and the form asks for the code and sends all three.
 *
 * Between the two steps the email and the password are held in memory only
 * (a ref of this component): never in the URL, in storage or in a hidden
 * field, and gone on going back, on a refusal that returns to the first step
 * and with the page.
 */
export function LoginForm() {
  const t = useTranslations("login");
  const credentials = useRef<{ email: string; password: string } | null>(null);
  // The code step takes the app's six digits or, on asking, a recovery code.
  const [recovery, setRecovery] = useState(false);

  const [, startTransition] = useTransition();

  const [state, formAction, isPending] = useActionState(
    async (previous: LoginState, form: FormData | "back"): Promise<LoginState> => {
      const firstStep: LoginState = { step: "password", error: null, tries: 0 };
      if (form === "back") {
        credentials.current = null;
        return firstStep;
      }
      if (previous.step === "code") {
        const held = credentials.current;
        if (!held) return firstStep;
        form.set("email", held.email);
        form.set("password", held.password);
      } else {
        credentials.current = { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") };
      }

      const result = await loginAction(null, form);
      if (!result) {
        // Signed in: the action redirects to the portal. Nothing more to hold or show.
        credentials.current = null;
        return previous;
      }
      if (result.error === "mfa_required") return { step: "code", error: null, tries: 0 };
      // A wrong code, or too many of them: still on the code step.
      if (previous.step === "code" && (result.error === "invalid_code" || result.error === "too_many_attempts")) {
        return { step: "code", error: result.error, tries: previous.tries + 1 };
      }
      credentials.current = null;
      return { ...firstStep, error: result.error };
    },
    { step: "password", error: null, tries: 0 },
  );

  const message = state.error && (
    <FormMessage role="alert" className="text-center">
      {t(ERROR_KEY[state.error])}
    </FormMessage>
  );

  if (state.step === "code") {
    return (
      <form action={formAction} className="mt-12 flex w-full max-w-[380px] flex-col gap-5">
        <h2 className="text-center text-xl">{t("code.title")}</h2>
        <Field>
          <Label htmlFor="code" className="text-xs tracking-[0.08em] uppercase">
            {t(recovery ? "code.recoveryLabel" : "code.label")}
          </Label>
          <Input
            // A new field for the other kind of code, and after each try: never a code left in it.
            key={`${recovery ? "recovery" : "app"}-${state.tries}`}
            id="code"
            name="code"
            type="text"
            required
            autoFocus
            inputMode={recovery ? "text" : "numeric"}
            autoComplete={recovery ? "off" : "one-time-code"}
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby="code-hint"
            className="num h-12 px-4 text-center text-lg tracking-[0.2em]"
          />
          <FieldDescription id="code-hint">{t(recovery ? "code.recoveryHint" : "code.hint")}</FieldDescription>
        </Field>

        <Button type="submit" disabled={isPending} size="lg" className="mt-1 h-12 bg-verde-oliva text-white">
          {isPending ? t("code.submitting") : t("code.submit")}
        </Button>

        {message}

        <div className="flex flex-col items-center gap-1">
          <Button type="button" variant="link" onClick={() => setRecovery(!recovery)}>
            {t(recovery ? "code.useApp" : "code.useRecovery")}
          </Button>
          <Button
            type="button"
            variant="link"
            disabled={isPending}
            onClick={() => {
              setRecovery(false);
              startTransition(() => formAction("back"));
            }}
          >
            {t("code.back")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form action={formAction} className="mt-12 flex w-full max-w-[380px] flex-col gap-5">
      <Field>
        <Label htmlFor="email" className="text-xs tracking-[0.08em] uppercase">
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
        <Label htmlFor="password" className="text-xs tracking-[0.08em] uppercase">
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

      {message}
    </form>
  );
}
