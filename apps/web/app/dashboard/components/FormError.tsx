"use client";

import { useTranslations } from "next-intl";
import { FormMessage } from "@/components/ui/field";

/** An error code from a form's action, translated from `<namespace>.<code>`. */
export default function FormError({ namespace, error }: { namespace: string; error?: string }) {
  const t = useTranslations(namespace);
  if (!error) return null;
  return <FormMessage role="alert">{t(error)}</FormMessage>;
}
