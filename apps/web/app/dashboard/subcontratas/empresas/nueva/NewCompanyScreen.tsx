"use client";

// Container: the only part of the flow that talks to the server. It runs the
// wizard over its steps (fewer for a material supplier); on the review screen it creates the company (with
// its obra and "No aplica" documents, in one call), then uploads each chosen
// file in a request of its own (a function body is limited to 4.5 MB).

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { SubcontractorError } from "@repo/core/contract";
import { createSubcontractorAction, uploadSubcontractorDocumentAction } from "../../../../actions/subcontractors";
import { buttonVariants } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import ReviewStep from "../../../components/wizard/ReviewStep";
import Wizard from "../../../components/wizard/Wizard";
import { useWizard } from "../../../components/wizard/useWizard";
import { companyHref, useRequirementName } from "../../components/display";
import { EMPTY_COMPANY_FLOW, createInput, uploadsOf, type CompanyFlowOptions } from "./draft";
import { COMPANY_STEPS } from "./steps";
import RegistrationStatus from "./steps/RegistrationStatus";

export default function NewCompanyScreen({ options }: { options: CompanyFlowOptions }) {
  const t = useTranslations("subcontractors.wizard");
  const te = useTranslations("subcontractors.errors");
  const name = useRequirementName();
  const router = useRouter();
  const wizard = useWizard(COMPANY_STEPS, EMPTY_COMPANY_FLOW, options);
  const { steps } = wizard;
  const [error, setError] = useState<string | null>(null);
  // Set once the company exists but one of its uploads failed.
  const [created, setCreated] = useState<{ id: string; failed: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const sections = steps.map((step) => ({ id: step.id, title: t(`steps.${step.titleKey}`), Summary: step.Summary }));
  const stops = [
    ...sections.map((section, index) => ({ id: section.id, title: section.title, reachable: wizard.canReach(index) })),
    { id: "review", title: t("steps.review"), reachable: wizard.canReach(steps.length) },
  ];

  const message = (code: SubcontractorError | undefined) =>
    code && te.has(code) ? te(code) : t("errors.generic");

  async function submit() {
    const { draft } = wizard;
    const result = await createSubcontractorAction(createInput(draft));
    if (!result?.success || !result.id) {
      setError(message(result?.error));
      if (result?.error) wizard.goToError(result.error);
      return;
    }
    const id = result.id;
    const failed: string[] = [];
    for (const upload of uploadsOf(draft)) {
      const formData = new FormData();
      for (const [key, value] of Object.entries(upload)) if (value) formData.set(key, value);
      const done = await uploadSubcontractorDocumentAction(id, formData);
      if (!done?.success) failed.push(name(upload.requirementId, draft.kind));
    }
    if (failed.length > 0) setCreated({ id, failed });
    else router.push(companyHref(id));
  }

  function handleNext() {
    setError(null);
    if (!wizard.isReview) return wizard.next();
    if (created) return router.push(companyHref(created.id));
    startTransition(submit);
  }

  const Step = wizard.step?.Component;

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <Wizard
          title={t("title")}
          steps={stops}
          position={wizard.position}
          isFirst={wizard.isFirst}
          isReview={wizard.isReview}
          pending={pending}
          finishLabel={created ? t("goToCompany") : pending ? t("registering") : t("register")}
          cancelHref="/dashboard/subcontratas/empresas"
          error={error ?? undefined}
          onNext={handleNext}
          onBack={() => {
            setError(null);
            wizard.back();
          }}
          onGoTo={(position) => {
            setError(null);
            wizard.goTo(position);
          }}
        >
          {created && (
            <div role="alert" className="flex flex-col gap-2 rounded-[10px] bg-warn-soft px-3.5 py-3 text-[13.5px] text-warn">
              <p className="m-0 font-semibold">{t("partial")}</p>
              <p className="m-0">{created.failed.join(", ")}</p>
              <Link className={buttonVariants({ variant: "outline", size: "sm", className: "w-fit" })} href={companyHref(created.id)}>
                {t("goToCompany")}
              </Link>
            </div>
          )}
          {Step ? (
            <Step draft={wizard.draft} onChange={wizard.update} options={options} />
          ) : (
            <ReviewStep sections={sections} draft={wizard.draft} options={options} onEdit={wizard.goTo} intro={t("reviewIntro")} />
          )}
          {pending && (
            <FormMessage role="status" tone="success">
              {t("registering")}
            </FormMessage>
          )}
        </Wizard>
      </div>
      <RegistrationStatus draft={wizard.draft} projects={options.projects} />
    </div>
  );
}
