"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";

export default function ClientsHeader({
  count,
  created,
  onCreate,
}: {
  count: number;
  /** Shows the "client created" confirmation. */
  created: boolean;
  onCreate: () => void;
}) {
  const t = useTranslations("clientsPage");
  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between">
        <h1>
          {t("title")}
          <span className="ml-2 font-normal text-muted-foreground">({count})</span>
        </h1>
        <Button type="button" className="self-start md:self-auto" onClick={onCreate}>
          + {t("newClient")}
        </Button>
      </div>
      {created && (
        <FormMessage role="status" tone="success">
          {t("created")}
        </FormMessage>
      )}
    </>
  );
}
