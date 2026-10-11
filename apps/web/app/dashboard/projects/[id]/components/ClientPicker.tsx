"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ClientOption, ProjectClientError } from "@repo/core/contract";
import FormError from "../../../components/FormError";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/** Presentational: pick an existing client for the project. */
export default function ClientPicker({
  clients,
  action,
  pending,
  error,
}: {
  clients: ClientOption[];
  action: (formData: FormData) => void;
  pending: boolean;
  error?: ProjectClientError;
}) {
  const t = useTranslations("projectDetailPage.clientAccess");

  if (clients.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        {t.rich("noClients", {
          link: (chunks) => (
            <Link href="/dashboard/clients" className="font-medium text-info hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-[13px] text-muted-foreground">{t("intro")}</p>
      <Field>
        <Label htmlFor="client-id">{t("client")}</Label>
        <NativeSelect id="client-id" name="clientId" required defaultValue="">
          <NativeSelectOption value="" disabled>
            {t("choose")}
          </NativeSelectOption>
          {clients.map((client) => (
            <NativeSelectOption key={client.id} value={client.id}>
              {client.name ? `${client.name} — ${client.email}` : client.email}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <FormError namespace="projectDetailPage.clientAccess.errors" error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("assigning") : t("assign")}
        </Button>
      </div>
    </form>
  );
}
