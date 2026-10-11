"use client";

import { useTranslations } from "next-intl";
import type { ClientOption, ProjectClientError } from "@repo/core/contract";
import FormError from "../../../components/FormError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Presentational: the client attached to the project. */
export default function AssignedClient({
  client,
  onRemove,
  removing,
  error,
}: {
  client: ClientOption;
  onRemove: () => void;
  removing: boolean;
  error?: ProjectClientError;
}) {
  const t = useTranslations("projectDetailPage.clientAccess");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 flex-col items-start gap-0.5">
        <Badge variant="good" className="mb-1.5">
          {t("active")}
        </Badge>
        <span className="text-[15px] font-semibold wrap-anywhere">
          {client.name ?? client.email}
        </span>
        <span className="text-[13px] wrap-anywhere text-muted-foreground">{client.email}</span>
      </div>
      <FormError namespace="projectDetailPage.clientAccess.errors" error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="destructive" onClick={onRemove} disabled={removing}>
          {t("remove")}
        </Button>
      </div>
    </div>
  );
}
