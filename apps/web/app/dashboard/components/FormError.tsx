"use client";

import { useTranslations } from "next-intl";
import { FormMessage } from "@/components/ui/field";

/**
 * An error code from a form's action, translated from `<namespace>.<code>`;
 * a code the namespace doesn't know falls back to its `generic` line.
 */
export default function FormError({ namespace, error }: { namespace: string; error?: string | null }) {
  const t = useTranslations(namespace);
  if (!error) return null;
  return <FormMessage role="alert">{t.has(error) || !t.has("generic") ? t(error) : t("generic")}</FormMessage>;
}
