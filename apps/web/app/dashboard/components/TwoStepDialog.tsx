"use client";

import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { MfaEnrolment, MfaStatus } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FormActions, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FormError from "./FormError";

/** What the dialog asks of the server; each answers an error code, or what it made. */
export type TwoStepActions = {
  /** Starts enrolling: the secret for the authenticator app. */
  begin: () => Promise<{ error?: string; enrolment?: MfaEnrolment }>;
  /** The form's `code` confirms it; the recovery codes come back once. */
  confirm: (form: FormData) => Promise<{ error?: string; recoveryCodes?: string[] }>;
  /** Turns it off with the form's `password` and `code`. */
  disable: (form: FormData) => Promise<{ error?: string }>;
  /** New recovery codes for the form's `code`. */
  regenerate: (form: FormData) => Promise<{ error?: string; recoveryCodes?: string[] }>;
};

type View =
  | { name: "home" }
  | { name: "setup"; enrolment: MfaEnrolment }
  | { name: "codes"; codes: string[]; after: "enabled" | "regenerated" }
  | { name: "regenerate" }
  | { name: "disable" }
  | { name: "disabled" };

/** The secret in groups of four, as authenticator apps show it: easier to type. */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

/**
 * Presentational: the signed-in user's two-step verification. Off: switch it
 * on (scan the QR code or type the secret, then one code to confirm), and see
 * the recovery codes that once. On: new recovery codes, or switch it off (the
 * password and a code). Nothing it shows is kept once it closes.
 */
export default function TwoStepDialog({
  open,
  onOpenChange,
  status,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: MfaStatus;
  actions: TwoStepActions;
}) {
  const t = useTranslations("account.twoStep");
  const id = useId();
  const [view, setView] = useState<View>({ name: "home" });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function show(next: View) {
    setError(null);
    setCopied(false);
    setView(next);
  }

  function change(next: boolean) {
    // Closed: no secret, no codes and no old outcome are left for the next time.
    if (!next) show({ name: "home" });
    onOpenChange(next);
  }

  /** Runs an action; an error stays on the view, anything else goes to `then`. */
  function run<T extends { error?: string }>(action: () => Promise<T>, then: (result: T) => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else then(result);
    });
  }

  const submit = (send: (form: FormData) => void) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send(new FormData(event.currentTarget));
  };

  const codeField = (label: string, hint?: string, appOnly = false) => (
    <Field>
      <Label htmlFor={`${id}-code`}>{label}</Label>
      <Input
        id={`${id}-code`}
        name="code"
        type="text"
        required
        inputMode={appOnly ? "numeric" : "text"}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        className="num"
        aria-describedby={hint ? `${id}-code-hint` : undefined}
      />
      {hint && <FieldDescription id={`${id}-code-hint`}>{hint}</FieldDescription>}
    </Field>
  );

  const errorLine = <FormError namespace="account.twoStep.errors" error={error} />;
  const backButton = (
    <Button type="button" variant="outline" onClick={() => show({ name: "home" })}>
      {t("back")}
    </Button>
  );

  let body: ReactNode;
  if (view.name === "setup") {
    body = (
      <form
        onSubmit={submit((form) =>
          run(
            () => actions.confirm(form),
            (result) => show({ name: "codes", codes: result.recoveryCodes ?? [], after: "enabled" }),
          ),
        )}
        className="flex min-w-0 flex-col gap-3"
      >
        <p>{t("setup.scan")}</p>
        {/* The server drew it (a data: URL): always dark on white, as scanners expect. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={view.enrolment.qr}
          alt={t("setup.qrAlt")}
          width={184}
          height={184}
          className="size-[184px] self-center rounded-lg border"
        />
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">{t("setup.manual")}</p>
          {/* In groups of four that wrap: it must fit a phone's width (`num` would keep it on one line). */}
          <p className="rounded-lg bg-raise px-3 py-2 font-mono text-[13px] select-all" aria-label={t("setup.secretLabel")}>
            {grouped(view.enrolment.secret)}
          </p>
        </div>
        <p>{t("setup.enter")}</p>
        {codeField(t("setup.code"), undefined, true)}
        {errorLine}
        <FormActions>
          <Button type="button" variant="outline" onClick={() => change(false)}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t("setup.confirming") : t("setup.confirm")}
          </Button>
        </FormActions>
      </form>
    );
  } else if (view.name === "codes") {
    body = (
      <>
        <FormMessage tone="success" role="status">
          {t(`codes.${view.after}`)}
        </FormMessage>
        <div className="flex flex-col gap-1.5">
          <p className="eyebrow">{t("codes.title")}</p>
          <ul className="num grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-raise px-3 py-2.5 text-[13px]" aria-label={t("codes.title")}>
            {view.codes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t("codes.help")}</p>
        </div>
        <FormActions>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              // Refused (no permission, an insecure page): the codes are on screen to copy by hand.
              void navigator.clipboard?.writeText(view.codes.join("\n")).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? t("codes.copied") : t("codes.copy")}
          </Button>
          <Button type="button" onClick={() => change(false)}>
            {t("codes.done")}
          </Button>
        </FormActions>
      </>
    );
  } else if (view.name === "regenerate") {
    body = (
      <form
        onSubmit={submit((form) =>
          run(
            () => actions.regenerate(form),
            (result) => show({ name: "codes", codes: result.recoveryCodes ?? [], after: "regenerated" }),
          ),
        )}
        className="flex min-w-0 flex-col gap-3"
      >
        <p>{t("regenerate.help")}</p>
        {codeField(t("anyCode"), t("anyCodeHint"))}
        {errorLine}
        <FormActions>
          {backButton}
          <Button type="submit" disabled={pending}>
            {pending ? t("regenerate.submitting") : t("regenerate.submit")}
          </Button>
        </FormActions>
      </form>
    );
  } else if (view.name === "disable") {
    body = (
      <form
        onSubmit={submit((form) => run(() => actions.disable(form), () => show({ name: "disabled" })))}
        className="flex min-w-0 flex-col gap-3"
      >
        <p>{t("disable.help")}</p>
        <Field>
          <Label htmlFor={`${id}-password`}>{t("disable.password")}</Label>
          <Input id={`${id}-password`} name="password" type="password" required autoComplete="current-password" />
        </Field>
        {codeField(t("anyCode"), t("anyCodeHint"))}
        {errorLine}
        <FormActions>
          {backButton}
          <Button type="submit" variant="destructive" disabled={pending}>
            {pending ? t("disable.submitting") : t("disable.submit")}
          </Button>
        </FormActions>
      </form>
    );
  } else if (view.name === "disabled") {
    body = (
      <>
        <FormMessage tone="success" role="status">
          {t("disable.done")}
        </FormMessage>
        <FormActions>
          <Button type="button" onClick={() => change(false)}>
            {t("close")}
          </Button>
        </FormActions>
      </>
    );
  } else if (status.enabled) {
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="good">{t("on.status")}</Badge>
          <span className="text-muted-foreground">{t("on.codesLeft", { count: status.recoveryCodesLeft })}</span>
        </div>
        <FormActions>
          <Button type="button" variant="ghost-destructive" onClick={() => show({ name: "disable" })}>
            {t("on.disable")}
          </Button>
          <Button type="button" variant="outline" onClick={() => show({ name: "regenerate" })}>
            {t("on.regenerate")}
          </Button>
        </FormActions>
      </>
    );
  } else {
    body = (
      <>
        <div className="flex flex-col gap-2">
          <Badge variant="outline">{t("off.status")}</Badge>
          <p>{t("off.intro")}</p>
        </div>
        {errorLine}
        <FormActions>
          <Button type="button" variant="outline" onClick={() => change(false)}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              run(actions.begin, (result) => {
                if (result.enrolment) show({ name: "setup", enrolment: result.enrolment });
              })
            }
          >
            {pending ? t("off.starting") : t("off.start")}
          </Button>
        </FormActions>
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent closeLabel={t("close")}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
