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

  const status = (client: ClientListItem) => (
    <Badge variant={client.active ? "good" : "outline"}>
      {client.active ? t("statuses.active") : t("statuses.inactive")}
    </Badge>
  );
  const deletion = (client: ClientListItem) =>
    client.deletionRequestedAt && (
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
    );
  const setPassword = (client: ClientListItem) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => onSetPassword(client)}
      aria-label={t("setPasswordFor", { name: displayName(client) })}
    >
      {t("setPassword")}
    </Button>
  );

  return (
    <Card size="list">
      {/* Phones: one card per client. */}
      <ul className="m-0 flex list-none flex-col p-0 md:hidden">
        {clients.map((client) => (
          <li key={client.id} className="flex flex-col gap-2 border-b py-3.5 last:border-b-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{displayName(client)}</span>
              {status(client)}
            </div>
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              {(
                [
                  [t("table.email"), client.email],
                  [t("table.phone"), client.phone ?? dash],
                  [t("table.dateOfBirth"), date(client.dateOfBirth)],
                  [t("table.address"), client.address ?? dash],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="m-0 wrap-anywhere">{value}</dd>
                </div>
              ))}
            </dl>
            {client.deletionRequestedAt && <div className="flex flex-wrap items-center gap-2">{deletion(client)}</div>}
            <div>{setPassword(client)}</div>
          </li>
        ))}
      </ul>
      <Table className="hidden md:table">
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
                  {status(client)}
                  {deletion(client)}
                </div>
              </TableCell>
              <TableCell>{setPassword(client)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
