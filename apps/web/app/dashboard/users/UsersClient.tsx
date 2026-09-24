"use client";

import { useState, useActionState } from "react";
import { useTranslations } from "next-intl";
import shared from "../shared.module.css";
import styles from "./page.module.css";
import {
  createUser,
  updateUserRole,
  toggleUserActive,
} from "../../actions/users";

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  role: "admin" | "manager" | "viewer";
  active: boolean;
  createdAt: string | Date;
};

const ROLE_STYLE: Record<string, string> = {
  admin: styles.roleAdmin!,
  manager: styles.roleManager!,
  viewer: styles.roleViewer!,
};

export function UsersClient({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string | null;
}) {
  const t = useTranslations("usersPage");
  const [showForm, setShowForm] = useState(false);
  const [formState, formAction, isPending] = useActionState(createUser, null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function runRowAction(action: Promise<{ error?: string }>) {
    const result = await action;
    setRowError(result.error ?? null);
  }

  return (
    <>
      <div className={styles.header}>
        <div className={styles.title}>
          {t("title")}
          <span className={styles.count}>({users.length})</span>
        </div>
        <button
          type="button"
          className={styles.inviteBtn}
          onClick={() => setShowForm(!showForm)}
        >
          + {t("inviteUser")}
        </button>
      </div>

      {rowError && (
        <div className={styles.formError} role="alert">
          {t(`errors.${rowError}`)}
        </div>
      )}

      {showForm && (
        <div className={styles.formOverlay}>
          <div className={styles.formCard}>
            <div className={styles.formTitle}>{t("inviteForm.title")}</div>

            {formState?.error && (
              <div className={styles.formError}>
                {t(`errors.${formState.error}`)}
              </div>
            )}
            {formState?.success && (
              <div className={styles.formSuccess}>{t("success.created")}</div>
            )}

            <form action={formAction}>
              <div className={styles.formGrid}>
                <div className={styles.formField}>
                  <label htmlFor="name">{t("inviteForm.nameLabel")}</label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    placeholder={t("inviteForm.namePlaceholder")}
                    required
                  />
                </div>
                <div className={styles.formField}>
                  <label htmlFor="email">{t("inviteForm.emailLabel")}</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    placeholder={t("inviteForm.emailPlaceholder")}
                    required
                  />
                </div>
                <div className={styles.formField}>
                  <label htmlFor="password">
                    {t("inviteForm.passwordLabel")}
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    placeholder={t("inviteForm.passwordPlaceholder")}
                    minLength={8}
                    required
                  />
                </div>
                <div className={styles.formField}>
                  <label htmlFor="role">{t("inviteForm.roleLabel")}</label>
                  <select id="role" name="role" defaultValue="viewer">
                    <option value="admin">{t("roles.admin")}</option>
                    <option value="manager">{t("roles.manager")}</option>
                    <option value="viewer">{t("roles.viewer")}</option>
                  </select>
                </div>
              </div>
              <div className={styles.formActions}>
                <button
                  type="submit"
                  className={styles.submitBtn}
                  disabled={isPending}
                >
                  {isPending
                    ? t("inviteForm.submitting")
                    : t("inviteForm.submit")}
                </button>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setShowForm(false)}
                >
                  {t("inviteForm.cancel")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className={styles.tableWrapper}>
        <table className={shared.table}>
          <thead>
            <tr>
              <th>{t("table.name")}</th>
              <th>{t("table.email")}</th>
              <th>{t("table.role")}</th>
              <th>{t("table.status")}</th>
              <th>{t("table.created")}</th>
              <th>{t("table.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td style={{ fontWeight: 500 }}>{user.name ?? "—"}</td>
                <td style={{ color: "#6b6b6b" }}>{user.email}</td>
                <td>
                  <span
                    className={`${shared.chip} ${ROLE_STYLE[user.role] ?? ""}`}
                  >
                    {t(`roles.${user.role}`)}
                  </span>
                </td>
                <td>
                  <span
                    className={
                      user.active ? styles.statusActive : styles.statusInactive
                    }
                    style={{ fontSize: 11, fontWeight: 500 }}
                  >
                    {user.active
                      ? t("statuses.active")
                      : t("statuses.inactive")}
                  </span>
                </td>
                <td style={{ color: "#6b6b6b", fontSize: 11 }}>
                  {new Date(user.createdAt).toLocaleDateString("es-ES")}
                </td>
                <td>
                  <div className={styles.actions}>
                    <select
                      className={styles.roleSelect}
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
                            e.target.value as "admin" | "manager" | "viewer",
                          ),
                        )
                      }
                    >
                      <option value="admin">{t("roles.admin")}</option>
                      <option value="manager">{t("roles.manager")}</option>
                      <option value="viewer">{t("roles.viewer")}</option>
                    </select>
                    {user.active ? (
                      <button
                        type="button"
                        className={styles.deactivateBtn}
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
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.activateBtn}
                        onClick={() =>
                          runRowAction(toggleUserActive(user.id, true))
                        }
                      >
                        {t("actions.activate")}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
