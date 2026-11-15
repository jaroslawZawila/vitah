"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import FormError from "./FormError";

type Translate = ReturnType<typeof useTranslations>;

/** The dialog's text, translated. */
type ConfirmText = {
  /** Names the record: "¿Eliminar la factura MSN-2026/148?" */
  title: string;
  /** What happens, in one or two plain sentences. */
  description: string;
  /** The action itself ("Eliminar factura"), never "OK". */
  confirmLabel: string;
  /** Instead of "Cancelar" when the action itself is a cancel ("Mantener pedido"). */
  cancelLabel?: string;
};

/**
 * The same text from the messages under `key`: `title`, `description`,
 * `confirm` and, with `keep`, `keep` for the cancel button; each is given `values`.
 */
type ConfirmKey = { t: Translate; key: string; values?: Parameters<Translate>[1]; keep?: boolean };

/** What to ask, and what to run once the user confirms. */
export type ConfirmRequest = (ConfirmText | ConfirmKey) & {
  destructive?: boolean;
  /** The confirm button's text while the action runs, instead of "Un momento…". */
  pendingLabel?: string;
  /** A server action: `{ error }` keeps the dialog open and shows it. */
  action: () => Promise<{ error?: string | null; success?: boolean } | null | undefined | void>;
  /** After it succeeded and the dialog closed (e.g. leave the page). */
  onDone?: () => void;
};

function textOf(request: ConfirmRequest): ConfirmText {
  if (!("key" in request)) return request;
  const { t, key, values, keep } = request;
  return {
    title: t(`${key}.title`, values),
    description: t(`${key}.description`, values),
    confirmLabel: t(`${key}.confirm`, values),
    cancelLabel: keep ? t(`${key}.keep`, values) : undefined,
  };
}

/**
 * A container asks for confirmation with `ask(...)` and renders `dialog`
 * once, where the dialog belongs (inside another dialog if it opens from
 * one). The action runs from the dialog, which stays open while it runs and
 * shows its error, translated from `errorNamespace` (as `FormError`).
 */
export function useConfirm(errorNamespace: string) {
  const t = useTranslations("confirmDialog");
  // Kept after closing, so the text doesn't vanish while the dialog fades out.
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function ask(next: ConfirmRequest) {
    setRequest(next);
    setError(null);
    setOpen(true);
  }

  function confirm() {
    if (!request) return;
    setError(null);
    startTransition(async () => {
      const result = await request.action();
      // In the transition too, so the error shows as the buttons come back.
      startTransition(() => {
        if (result?.error) return setError(result.error);
        setOpen(false);
        request.onDone?.();
      });
    });
  }

  const text = request && textOf(request);
  const dialog = request && text && (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={text.title}
      description={text.description}
      confirmLabel={text.confirmLabel}
      cancelLabel={text.cancelLabel ?? t("cancel")}
      pendingLabel={request.pendingLabel ?? t("working")}
      destructive={request.destructive}
      pending={pending}
      error={<FormError namespace={errorNamespace} error={error} />}
      onConfirm={confirm}
    />
  );

  return { ask, dialog, pending };
}
