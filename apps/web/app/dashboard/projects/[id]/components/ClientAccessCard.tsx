"use client";

import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { MIN_PASSWORD_LENGTH } from "@repo/core/contract";
import {
  createProjectClientAction,
  resetProjectClientPasswordAction,
  revokeProjectClientAction,
  type ClientAccessState,
} from "../../../../actions/project-client";
import shared from "../../../shared.module.css";
import styles from "./ClientAccessCard.module.css";

type Client = { id: string; name: string | null; email: string };

/** Admin-only card for giving the homeowner access to the mobile app. */
export default function ClientAccessCard({
  projectId,
  client,
}: {
  projectId: string;
  client: Client | null;
}) {
  const t = useTranslations("projectDetailPage.clientAccess");

  return (
    <section className={shared.card} aria-labelledby="client-access-title">
      <h2 id="client-access-title" className={shared.cardTitle}>
        {t("title")}
      </h2>
      {client ? (
        <AttachedClient projectId={projectId} client={client} />
      ) : (
        <GrantAccessForm projectId={projectId} />
      )}
    </section>
  );
}

function ErrorMessage({ state }: { state: ClientAccessState }) {
  const t = useTranslations("projectDetailPage.clientAccess.errors");
  if (!state?.error) return null;
  return (
    <p role="alert" className={styles.error}>
      {t(state.error)}
    </p>
  );
}

function PasswordField({ id, label }: { id: string; label: string }) {
  const t = useTranslations("projectDetailPage.clientAccess");
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name="password"
        type="password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
      />
      <span className={styles.hint}>{t("passwordHint")}</span>
    </div>
  );
}

function GrantAccessForm({ projectId }: { projectId: string }) {
  const t = useTranslations("projectDetailPage.clientAccess");
  const [state, formAction, pending] = useActionState(
    createProjectClientAction.bind(null, projectId),
    null,
  );

  return (
    <form action={formAction} className={styles.form}>
      <p className={styles.intro}>{t("intro")}</p>
      <div className={styles.field}>
        <label htmlFor="client-name">{t("name")}</label>
        <input id="client-name" name="name" required autoComplete="off" />
      </div>
      <div className={styles.field}>
        <label htmlFor="client-email">{t("email")}</label>
        <input id="client-email" name="email" type="email" required autoComplete="off" />
      </div>
      <PasswordField id="client-password" label={t("password")} />
      <ErrorMessage state={state} />
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? t("granting") : t("grant")}
        </button>
      </div>
    </form>
  );
}

function AttachedClient({ projectId, client }: { projectId: string; client: Client }) {
  const t = useTranslations("projectDetailPage.clientAccess");
  const [resetting, setResetting] = useState(false);
  const [revokeState, setRevokeState] = useState<ClientAccessState>(null);
  const [revoking, startRevoke] = useTransition();
  const [resetState, resetAction, resetPending] = useActionState(
    async (prev: ClientAccessState, formData: FormData) => {
      const next = await resetProjectClientPasswordAction(projectId, prev, formData);
      if (next?.success) setResetting(false);
      return next;
    },
    null,
  );

  function handleRevoke() {
    if (!confirm(t("confirmRevoke", { email: client.email }))) return;
    startRevoke(async () => {
      setRevokeState(await revokeProjectClientAction(projectId));
    });
  }

  return (
    <div className={styles.attached}>
      <div className={styles.identity}>
        <span className={styles.status}>{t("active")}</span>
        <span className={styles.clientName}>{client.name ?? client.email}</span>
        <span className={styles.clientEmail}>{client.email}</span>
      </div>

      {resetting ? (
        <form action={resetAction} className={styles.form}>
          <PasswordField id="client-new-password" label={t("newPassword")} />
          <ErrorMessage state={resetState} />
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={() => setResetting(false)}>
              {t("cancel")}
            </button>
            <button type="submit" className={styles.primary} disabled={resetPending}>
              {t("savePassword")}
            </button>
          </div>
        </form>
      ) : (
        <>
          {resetState?.success && (
            <p role="status" className={styles.success}>
              {t("passwordUpdated")}
            </p>
          )}
          <ErrorMessage state={revokeState} />
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={() => setResetting(true)}>
              {t("resetPassword")}
            </button>
            <button
              type="button"
              className={styles.danger}
              onClick={handleRevoke}
              disabled={revoking}
            >
              {t("revoke")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
