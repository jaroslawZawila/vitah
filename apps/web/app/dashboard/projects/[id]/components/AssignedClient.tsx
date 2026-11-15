"use client";

import { useTranslations } from "next-intl";
import type { ClientOption } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Presentational: the client attached to the project. */
export default function AssignedClient({
  client,
  onRemove,
  removing,
}: {
  client: ClientOption;
  /** Asks first (the container's dialog): the account stays. */
  onRemove: () => void;
  removing: boolean;
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
        <span className="text-sm wrap-anywhere text-muted-foreground">{client.email}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost-destructive" onClick={onRemove} disabled={removing}>
          {t("remove")}
        </Button>
      </div>
    </div>
  );
}
