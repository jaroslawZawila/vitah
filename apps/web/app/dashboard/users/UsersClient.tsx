"use client";

// Container: the only file of the page that calls server actions.

import { useState, useActionState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormat } from "@/lib/format";
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
  removeUserMfaAction,
  resetUserPasswordAction,
  updateUserPhoneAction,
  updateUserRole,
  toggleUserActive,
} from "../../actions/users";
import NewPasswordField from "../components/NewPasswordField";
import { useConfirm } from "../components/useConfirm";
import PhoneDialog from "./components/PhoneDialog";
import ResetPasswordDialog from "./components/ResetPasswordDialog";

const ROLES = ["admin", "manager", "viewer"] as const;
type Role = (typeof ROLES)[number];

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  /** Shown to the clients of the projects they are site manager of. */
  phone: string | null;
  role: Role;
  active: boolean;
  /** Signing in asks them for a two-step verification code. */
  mfaEnabled: boolean;
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
  const format = useFormat();
  const [showForm, setShowForm] = useState(false);
  const [formState, formAction, isPending] = useActionState(createUser, null);
  const [rowError, setRowError] = useState<string | null>(null);
  // Whose password the admin is setting, and whose was just set (their names only).
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const [resetDone, setResetDone] = useState<string | null>(null);
  // Whose two-step verification was just removed.
  const [mfaRemoved, setMfaRemoved] = useState<string | null>(null);
  // Whose phone the admin is setting, and whose was just saved.
  const [phoneFor, setPhoneFor] = useState<UserRow | null>(null);
  const [phoneSaved, setPhoneSaved] = useState<string | null>(null);
  const confirm = useConfirm("usersPage.errors");
  const label = (user: UserRow) => user.name || user.email;

  /** The last outcome's line goes when something else is started. */
  function clearDone() {
    setResetDone(null);
    setMfaRemoved(null);
    setPhoneSaved(null);
  }

  async function runRowAction(action: Promise<{ error?: string }>) {
    clearDone();
    const result = await action;
    setRowError(result.error ?? null);
  }

  /** Asks first: their sessions end (and, deactivated, they can't sign in). */
  function askToDeactivate(user: UserRow) {
    clearDone();
    setRowError(null);
    confirm.ask({
      t,
      key: "deactivateDialog",
      values: { name: label(user) },
      destructive: true,
      action: () => toggleUserActive(user.id, false),
    });
  }

  function askToRemoveMfa(user: UserRow) {
    clearDone();
    setRowError(null);
    confirm.ask({
      t,
      key: "removeTwoStep",
      values: { name: label(user) },
      destructive: true,
      action: () => removeUserMfaAction(user.id),
      onDone: () => setMfaRemoved(label(user)),
    });
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
      {resetDone && (
        <FormMessage tone="success" role="status">
          {t("success.passwordReset", { name: resetDone })}
        </FormMessage>
      )}
      {mfaRemoved && (
        <FormMessage tone="success" role="status">
          {t("success.twoStepRemoved", { name: mfaRemoved })}
        </FormMessage>
      )}
      {phoneSaved && (
        <FormMessage tone="success" role="status">
          {t("success.phoneSaved", { name: phoneSaved })}
        </FormMessage>
      )}

      <PhoneDialog
        key={`phone-${phoneFor?.id}`}
        user={phoneFor ? { name: label(phoneFor), phone: phoneFor.phone } : null}
        onSubmit={(form) => updateUserPhoneAction(phoneFor!.id, form)}
        onDone={() => {
          setRowError(null);
          setPhoneSaved(phoneFor ? label(phoneFor) : null);
          setPhoneFor(null);
        }}
        onClose={() => setPhoneFor(null)}
      />

      <ResetPasswordDialog
        key={resetFor?.id}
        name={resetFor ? label(resetFor) : null}
        onSubmit={(form) => resetUserPasswordAction(resetFor!.id, form)}
        onDone={() => {
          setRowError(null);
          setResetDone(resetFor ? label(resetFor) : null);
          setResetFor(null);
        }}
        onClose={() => setResetFor(null)}
      />
      {confirm.dialog}

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
                <NewPasswordField label={t("inviteForm.passwordLabel")} />
                <Field>
                  <Label htmlFor="phone">{t("inviteForm.phoneLabel")}</Label>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    maxLength={200}
                    placeholder={t("inviteForm.phonePlaceholder")}
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
              <TableHead>{t("table.phone")}</TableHead>
              <TableHead>{t("table.role")}</TableHead>
              <TableHead>{t("table.status")}</TableHead>
              <TableHead>{t("table.twoStep")}</TableHead>
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
                  <div className="flex items-center gap-1.5">
                    <span className="num whitespace-nowrap text-muted-foreground">{user.phone ?? "—"}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={t("actions.editPhoneFor", { name: label(user) })}
                      onClick={() => {
                        clearDone();
                        setPhoneFor(user);
                      }}
                    >
                      {t("actions.editPhone")}
                    </Button>
                  </div>
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
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={user.mfaEnabled ? "good" : "outline"}>
                      {user.mfaEnabled ? t("twoStep.on") : t("twoStep.off")}
                    </Badge>
                    {/* Beside what it removes: for a colleague who lost their phone. */}
                    {user.mfaEnabled && (
                      <Button
                        type="button"
                        variant="ghost-destructive"
                        size="sm"
                        className="disabled:pointer-events-auto disabled:cursor-not-allowed"
                        disabled={user.id === currentUserId}
                        title={
                          user.id === currentUserId
                            ? t("errors.cannot_remove_own_mfa")
                            : undefined
                        }
                        aria-label={t("actions.removeTwoStepFor", { name: label(user) })}
                        onClick={() => askToRemoveMfa(user)}
                      >
                        {t("actions.removeTwoStep")}
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell className="num text-muted-foreground">
                  {format.date(user.createdAt)}
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
                        variant="ghost-destructive"
                        size="sm"
                        className="disabled:pointer-events-auto disabled:cursor-not-allowed"
                        disabled={user.id === currentUserId}
                        title={
                          user.id === currentUserId
                            ? t("errors.cannot_modify_self")
                            : undefined
                        }
                        onClick={() => askToDeactivate(user)}
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="disabled:pointer-events-auto disabled:cursor-not-allowed"
                      disabled={user.id === currentUserId}
                      title={
                        user.id === currentUserId
                          ? t("errors.cannot_reset_own_password")
                          : undefined
                      }
                      aria-label={t("actions.resetPasswordFor", { name: label(user) })}
                      onClick={() => {
                        clearDone();
                        setResetFor(user);
                      }}
                    >
                      {t("actions.resetPassword")}
                    </Button>
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
