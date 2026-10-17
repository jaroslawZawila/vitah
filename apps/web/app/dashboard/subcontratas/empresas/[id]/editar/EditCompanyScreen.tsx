"use client";

// Container: "Editar datos" of a company — the wizard's first two steps as one
// form. Every changed field lands in the company's Historial.

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { SubcontractorError } from "@repo/core/contract";
import { updateSubcontractorAction } from "../../../../../actions/subcontractors";
import { Button, buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { FormActions } from "@/components/ui/field";
import FormError from "../../../../components/FormError";
import { companyHref } from "../../../components/display";
import ActivityFields from "../../../components/fields/ActivityFields";
import CompanyDataFields from "../../../components/fields/CompanyDataFields";
import { activityComplete, companyDataComplete, type CompanyFormDraft } from "../../../components/fields/draft";

export default function EditCompanyScreen({ id, initial }: { id: string; initial: CompanyFormDraft }) {
  const t = useTranslations("subcontractors.edit");
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<SubcontractorError | undefined>();
  const [pending, startTransition] = useTransition();
  const onChange = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));
  const ready = companyDataComplete(draft) && activityComplete(draft);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    startTransition(async () => {
      const result = await updateSubcontractorAction(id, draft);
      if (result?.error) setError(result.error);
      else router.push(companyHref(id));
    });
  }

  return (
    <form className="flex max-w-[860px] flex-col gap-5" onSubmit={handleSubmit} aria-labelledby="edit-company-title">
      <header className="flex flex-col gap-1.5">
        <Link className="text-[12.5px] text-muted-foreground hover:text-foreground" href={companyHref(id)}>
          ← {initial.legalName}
        </Link>
        <h1 id="edit-company-title">{t("title")}</h1>
        <p className="m-0 text-[13px] text-muted-foreground">{t("intro")}</p>
      </header>
      <section className={cardVariants()} aria-labelledby="edit-company-data">
        <h2 id="edit-company-data">{t("data")}</h2>
        <CompanyDataFields draft={draft} onChange={onChange} />
      </section>
      <section className={cardVariants()} aria-labelledby="edit-company-activity">
        <h2 id="edit-company-activity">{t("activity")}</h2>
        <ActivityFields draft={draft} onChange={onChange} />
      </section>
      <FormError namespace="subcontractors.errors" error={error} />
      <FormActions>
        <Link href={companyHref(id)} className={buttonVariants({ variant: "outline" })}>
          {t("cancel")}
        </Link>
        <Button type="submit" disabled={pending || !ready}>
          {pending ? t("saving") : t("save")}
        </Button>
      </FormActions>
    </form>
  );
}
