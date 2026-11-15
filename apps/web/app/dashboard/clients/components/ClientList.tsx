"use client";

import { useTranslations } from "next-intl";
import type { ClientListItem } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useFormat } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { displayName } from "./display";

/**
 * Presentational: the clients table. A client who asked in the app for their
 * account to be deleted carries a pill with the date, and a way to mark it handled.
 */
export default function ClientList({
  clients,
  onSetPassword,
  onClearDeletionRequest,
}: {
  clients: ClientListItem[];
  onSetPassword: (client: ClientListItem) => void;
  onClearDeletionRequest: (client: ClientListItem) => void;
}) {
  const t = useTranslations("clientsPage");
  const format = useFormat();

  if (clients.length === 0)
    return <p className="py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>;

  const dash = "—";
  const date = (value: string | null) => (value ? format.date(value) : dash);

  return (
    <Card size="list">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("table.name")}</TableHead>
            <TableHead>{t("table.email")}</TableHead>
            <TableHead>{t("table.phone")}</TableHead>
            <TableHead>{t("table.dateOfBirth")}</TableHead>
            <TableHead>{t("table.address")}</TableHead>
            <TableHead>{t("table.status")}</TableHead>
            <TableHead>
              <span className="sr-only">{t("table.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((client) => (
            <TableRow key={client.id}>
              <TableCell className="font-medium">{displayName(client)}</TableCell>
              <TableCell className="text-muted-foreground">{client.email}</TableCell>
              <TableCell className="text-muted-foreground">{client.phone ?? dash}</TableCell>
              <TableCell className="text-muted-foreground">{date(client.dateOfBirth)}</TableCell>
              <TableCell className="min-w-48 whitespace-normal text-muted-foreground">
                {client.address ?? dash}
              </TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-1.5">
                  <Badge variant={client.active ? "good" : "outline"}>
                    {client.active ? t("statuses.active") : t("statuses.inactive")}
                  </Badge>
                  {client.deletionRequestedAt && (
                    <>
                      <Badge variant="warn">
                        {t("deletionRequested", { date: format.date(client.deletionRequestedAt) })}
                      </Badge>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        onClick={() => onClearDeletionRequest(client)}
                        aria-label={t("clearDeletion.buttonFor", { name: displayName(client) })}
                      >
                        {t("clearDeletion.button")}
                      </Button>
                    </>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onSetPassword(client)}
                  aria-label={t("setPasswordFor", { name: displayName(client) })}
                >
                  {t("setPassword")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
