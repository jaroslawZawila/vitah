"use client";

// Container: the only file of the page that calls server actions.

import { useState, useTransition } from "react";
import type { OfficeContact } from "@repo/core/contract";
import { updateOfficeContactAction } from "../../actions/contact";
import OfficeContactForm from "./components/OfficeContactForm";

export default function ContactoScreen({ office }: { office: OfficeContact }) {
  const [state, setState] = useState<Awaited<ReturnType<typeof updateOfficeContactAction>>>(null);
  const [pending, startTransition] = useTransition();
  // Not a form action: React resets the fields after one, even when it failed.
  const submit = (form: FormData) =>
    startTransition(async () => {
      setState(await updateOfficeContactAction(null, form));
    });
  return (
    <OfficeContactForm
      office={office}
      onSubmit={submit}
      pending={pending}
      error={state?.error}
      saved={state?.success === true}
    />
  );
}
