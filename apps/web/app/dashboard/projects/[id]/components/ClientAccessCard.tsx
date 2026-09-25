"use client";

// Container for the "Client app access" card: the only part that knows about
// server actions. The views (ClientPicker, AssignedClient) take props only.

import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { ClientOption } from "@repo/core/contract";
import {
  assignProjectClientAction,
  unassignProjectClientAction,
  type ClientAccessState,
} from "../../../../actions/project-client";
import shared from "../../../shared.module.css";
import AssignedClient from "./AssignedClient";
import ClientPicker from "./ClientPicker";

/** Admin-only card linking the project to the homeowner's app account. */
export default function ClientAccessCard({
  projectId,
  client,
  assignableClients,
}: {
  projectId: string;
  client: ClientOption | null;
  assignableClients: ClientOption[];
}) {
  const t = useTranslations("projectDetailPage.clientAccess");

  return (
    <section className={shared.card} aria-labelledby="client-access-title">
      <h2 id="client-access-title" className={shared.cardTitle}>
        {t("title")}
      </h2>
      {client ? (
        <Assigned projectId={projectId} client={client} />
      ) : (
        <Picker projectId={projectId} clients={assignableClients} />
      )}
    </section>
  );
}

function Picker({ projectId, clients }: { projectId: string; clients: ClientOption[] }) {
  const [state, action, pending] = useActionState(
    assignProjectClientAction.bind(null, projectId),
    null,
  );
  return <ClientPicker clients={clients} action={action} pending={pending} error={state?.error} />;
}

function Assigned({ projectId, client }: { projectId: string; client: ClientOption }) {
  const t = useTranslations("projectDetailPage.clientAccess");
  const [state, setState] = useState<ClientAccessState>(null);
  const [removing, startRemove] = useTransition();

  function handleRemove() {
    if (!confirm(t("confirmRemove", { email: client.email }))) return;
    startRemove(async () => {
      setState(await unassignProjectClientAction(projectId));
    });
  }

  return (
    <AssignedClient
      client={client}
      onRemove={handleRemove}
      removing={removing}
      error={state?.error}
    />
  );
}
