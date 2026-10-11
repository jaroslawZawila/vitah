"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ClientListItem } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { calendarDate, displayName } from "./display";

/** Presentational: the clients table. */
export default function ClientList({
  clients,
  onSetPassword,
}: {
  clients: ClientListItem[];
  onSetPassword: (client: ClientListItem) => void;
}) {
  const t = useTranslations("clientsPage");
  const format = useFormatter();

  if (clients.length === 0)
    return <p className="py-10 text-center text-[13.5px] text-muted-foreground">{t("empty")}</p>;

  const dash = "—";
  const date = (value: string | null) =>
    value ? format.dateTime(calendarDate(value), { dateStyle: "medium", timeZone: "UTC" }) : dash;

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
                <Badge variant={client.active ? "good" : "outline"}>
                  {client.active ? t("statuses.active") : t("statuses.inactive")}
                </Badge>
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
