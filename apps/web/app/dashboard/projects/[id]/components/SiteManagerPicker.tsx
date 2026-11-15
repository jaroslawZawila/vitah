"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ContactError, SiteManagerOption } from "@repo/core/contract";
import FormError from "../../../components/FormError";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FieldDescription, FormMessage } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/**
 * Presentational: the project's site manager, one of the active staff users.
 * The client's app shows their name, phone and email on Contacto.
 */
export default function SiteManagerPicker({
  current,
  options,
  action,
  pending,
  error,
  saved,
}: {
  current: SiteManagerOption | null;
  options: SiteManagerOption[];
  action: (formData: FormData) => void;
  pending: boolean;
  error?: ContactError;
  saved: boolean;
}) {
  const t = useTranslations("projectDetailPage.siteManager");
  const [chosenId, setChosenId] = useState(current?.id ?? "");
  // A saved message is about the selection saved, not the next one.
  const [edited, setEdited] = useState(false);
  const chosen = options.find((option) => option.id === chosenId);

  return (
    <section className={cardVariants()} aria-labelledby="site-manager-title">
      <h2 id="site-manager-title">{t("title")}</h2>
      <form action={action} onSubmit={() => setEdited(false)} className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        <Field>
          <Label htmlFor="site-manager">{t("label")}</Label>
          <NativeSelect
            id="site-manager"
            name="userId"
            value={chosenId}
            onChange={(event) => {
              setChosenId(event.target.value);
              setEdited(true);
            }}
          >
            <NativeSelectOption value="">{t("none")}</NativeSelectOption>
            {options.map((option) => (
              <NativeSelectOption key={option.id} value={option.id}>
                {option.name ? `${option.name} — ${option.email}` : option.email}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {chosen && (
            <FieldDescription>
              {chosen.phone ? t("phone", { phone: chosen.phone }) : t("noPhone")}
            </FieldDescription>
          )}
        </Field>
        <FormError namespace="projectDetailPage.siteManager.errors" error={error} />
        {saved && !pending && !edited && (
          <FormMessage tone="success" role="status">
            {t("saved")}
          </FormMessage>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || chosenId === (current?.id ?? "")}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </section>
  );
}
