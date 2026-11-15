"use client";

// Container for the "Client app access" card: the only part that knows about
// server actions. The views (ClientPicker, AssignedClient) take props only.

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { ClientOption } from "@repo/core/contract";
import {
  assignProjectClientAction,
  unassignProjectClientAction,
} from "../../../../actions/project-client";
import { useConfirm } from "../../../components/useConfirm";
import AssignedClient from "./AssignedClient";
import ClientPicker from "./ClientPicker";
import { cardVariants } from "@/components/ui/card";

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
    <section
      className={cardVariants()}
      aria-labelledby="client-access-title"
    >
      <h2 id="client-access-title">{t("title")}</h2>
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
  const confirm = useConfirm("projectDetailPage.clientAccess.errors");

  function handleRemove() {
    confirm.ask({
      t,
      key: "removeDialog",
      values: { name: client.name ?? client.email },
      destructive: true,
      action: () => unassignProjectClientAction(projectId),
    });
  }

  return (
    <>
      <AssignedClient client={client} onRemove={handleRemove} removing={confirm.pending} />
      {confirm.dialog}
    </>
  );
}
