"use client";

// Container: the only place that knows about server actions. It owns the
// screen state and feeds plain props/callbacks to the presentational
// components in ./components, which can be restyled or replaced freely.

import { useActionState, useState } from "react";
import type { ClientListItem } from "@repo/core/contract";
import {
  createClientAction,
  setClientPasswordAction,
  type ClientFormState,
} from "../../actions/clients";
import ClientForm from "./components/ClientForm";
import ClientList from "./components/ClientList";
import ClientsHeader from "./components/ClientsHeader";
import SetPasswordForm from "./components/SetPasswordForm";

export default function ClientsScreen({ clients }: { clients: ClientListItem[] }) {
  const [creating, setCreating] = useState(false);
  const [passwordFor, setPasswordFor] = useState<ClientListItem | null>(null);
  const [created, setCreated] = useState(false);

  function openCreate() {
    setPasswordFor(null);
    setCreated(false);
    setCreating(true);
  }

  function openSetPassword(client: ClientListItem) {
    setCreating(false);
    setCreated(false);
    setPasswordFor(client);
  }

  return (
    <>
      <ClientsHeader count={clients.length} created={created} onCreate={openCreate} />

      {creating && (
        <CreateClient
          onCancel={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            setCreated(true);
          }}
        />
      )}

      {passwordFor && (
        <SetPassword
          key={passwordFor.id}
          client={passwordFor}
          onDone={() => setPasswordFor(null)}
        />
      )}

      <ClientList clients={clients} onSetPassword={openSetPassword} />
    </>
  );
}

function CreateClient({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const [state, action, pending] = useActionState(
    async (prev: ClientFormState, formData: FormData) => {
      const next = await createClientAction(prev, formData);
      if (next?.success) onDone();
      return next;
    },
    null,
  );
  return <ClientForm action={action} pending={pending} error={state?.error} onCancel={onCancel} />;
}

function SetPassword({ client, onDone }: { client: ClientListItem; onDone: () => void }) {
  const [state, action, pending] = useActionState(
    async (prev: ClientFormState, formData: FormData) => {
      const next = await setClientPasswordAction(client.id, prev, formData);
      if (next?.success) onDone();
      return next;
    },
    null,
  );
  return (
    <SetPasswordForm
      client={client}
      action={action}
      pending={pending}
      error={state?.error}
      onCancel={onDone}
    />
  );
}
