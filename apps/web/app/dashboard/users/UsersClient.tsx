"use client";

import { useState, useActionState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createUser,
  updateUserRole,
  toggleUserActive,
} from "../../actions/users";

const ROLES = ["admin", "manager", "viewer"] as const;
type Role = (typeof ROLES)[number];

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string | Date;
};

const ROLE_BADGE = {
  admin: "info",
  manager: "default",
  viewer: "outline",
} as const;

export function UsersClient({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string | null;
}) {
  const t = useTranslations("usersPage");
  const format = useFormatter();
  const [showForm, setShowForm] = useState(false);
  const [formState, formAction, isPending] = useActionState(createUser, null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function runRowAction(action: Promise<{ error?: string }>) {
    const result = await action;
    setRowError(result.error ?? null);
  }

  const roleOptions = ROLES.map((role) => (
    <NativeSelectOption key={role} value={role}>
      {t(`roles.${role}`)}
    </NativeSelectOption>
  ));

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between">
        <h1>
          {t("title")}
          <span className="ml-2 font-normal text-muted-foreground">
            ({users.length})
          </span>
        </h1>
        <Button
          type="button"
          className="self-start md:self-auto"
          onClick={() => setShowForm(!showForm)}
        >
          + {t("inviteUser")}
        </Button>
      </div>

      {rowError && (
        <FormMessage role="alert">{t(`errors.${rowError}`)}</FormMessage>
      )}

      {showForm && (
        <div>
          <Card>
            <div className="text-[14.5px] font-semibold">
              {t("inviteForm.title")}
            </div>

            {formState?.error && (
              <FormMessage>{t(`errors.${formState.error}`)}</FormMessage>
            )}
            {formState?.success && (
              <FormMessage tone="success">{t("success.created")}</FormMessage>
            )}

            <form action={formAction} className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <Label htmlFor="name">{t("inviteForm.nameLabel")}</Label>
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    placeholder={t("inviteForm.namePlaceholder")}
                    required
                  />
                </Field>
                <Field>
                  <Label htmlFor="email">{t("inviteForm.emailLabel")}</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder={t("inviteForm.emailPlaceholder")}
                    required
                  />
                </Field>
                <Field>
                  <Label htmlFor="password">
                    {t("inviteForm.passwordLabel")}
                  </Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    placeholder={t("inviteForm.passwordPlaceholder")}
                    minLength={8}
                    required
                  />
                </Field>
                <Field>
                  <Label htmlFor="role">{t("inviteForm.roleLabel")}</Label>
                  <NativeSelect
                    id="role"
                    name="role"
                    defaultValue="viewer"
                  >
                    {roleOptions}
                  </NativeSelect>
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={isPending}>
                  {isPending
                    ? t("inviteForm.submitting")
                    : t("inviteForm.submit")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                >
                  {t("inviteForm.cancel")}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      <Card size="list">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.name")}</TableHead>
              <TableHead>{t("table.email")}</TableHead>
              <TableHead>{t("table.role")}</TableHead>
              <TableHead>{t("table.status")}</TableHead>
              <TableHead>{t("table.created")}</TableHead>
              <TableHead>{t("table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {user.email}
                </TableCell>
                <TableCell>
                  <Badge variant={ROLE_BADGE[user.role]}>
                    {t(`roles.${user.role}`)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={user.active ? "good" : "outline"}>
                    {user.active
                      ? t("statuses.active")
                      : t("statuses.inactive")}
                  </Badge>
                </TableCell>
                <TableCell className="num text-muted-foreground">
                  {format.dateTime(new Date(user.createdAt), {
                    day: "numeric",
                    month: "numeric",
                    year: "numeric",
                    // Server and browser must render the same text.
                    timeZone: "Europe/Madrid",
                  })}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <NativeSelect
                      size="sm"
                      className="w-fit"
                      value={user.role}
                      disabled={user.id === currentUserId}
                      title={
                        user.id === currentUserId
                          ? t("errors.cannot_modify_self")
                          : undefined
                      }
                      onChange={(e) =>
                        runRowAction(
                          updateUserRole(
                            user.id,
                            e.target.value as Role,
                          ),
                        )
                      }
                    >
                      {roleOptions}
                    </NativeSelect>
                    {user.active ? (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="disabled:pointer-events-auto disabled:cursor-not-allowed"
                        disabled={user.id === currentUserId}
                        title={
                          user.id === currentUserId
                            ? t("errors.cannot_modify_self")
                            : undefined
                        }
                        onClick={() =>
                          runRowAction(toggleUserActive(user.id, false))
                        }
                      >
                        {t("actions.deactivate")}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          runRowAction(toggleUserActive(user.id, true))
                        }
                      >
                        {t("actions.activate")}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
