"use client";

// Container: the only part of the flow that talks to the server. It runs the
// wizard over PROJECT_STEPS and submits the draft on the review screen.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createProject } from "../../../actions/projects";
import ReviewStep from "../../components/wizard/ReviewStep";
import Wizard from "../../components/wizard/Wizard";
import { activeSteps } from "../../components/wizard/types";
import { useWizard } from "../../components/wizard/useWizard";
import { EMPTY_PROJECT_DRAFT, type ProjectFlowOptions } from "./draft";
import { PROJECT_STEPS } from "./steps";

export default function NewProjectScreen({
  options,
  allSteps = PROJECT_STEPS,
}: {
  options: ProjectFlowOptions;
  /** Overridable for tests. */
  allSteps?: typeof PROJECT_STEPS;
}) {
  const t = useTranslations("newProjectPage");
  const router = useRouter();
  const steps = useMemo(() => activeSteps(allSteps, options), [allSteps, options]);
  const wizard = useWizard(steps, EMPTY_PROJECT_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sections = steps.map((step) => ({
    id: step.id,
    title: t(`steps.${step.titleKey}`),
    Summary: step.Summary,
  }));
  const stops = [
    ...sections.map((section, index) => ({
      id: section.id,
      title: section.title,
      reachable: wizard.canReach(index),
    })),
    { id: "review", title: t("steps.review"), reachable: wizard.canReach(steps.length) },
  ];

  function handleNext() {
    setError(null);
    if (!wizard.isReview) return wizard.next();

    startTransition(async () => {
      const result = await createProject(wizard.draft);
      if (result?.success && result.id) {
        router.push(`/dashboard/projects/${result.id}`);
        return;
      }
      const code = result?.error ?? "generic";
      setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.generic"));
      wizard.goToError(code);
    });
  }

  const Step = wizard.step?.Component;

  return (
    <Wizard
      title={t("title")}
      steps={stops}
      position={wizard.position}
      isFirst={wizard.isFirst}
      isReview={wizard.isReview}
      pending={pending}
      finishLabel={pending ? t("creating") : t("create")}
      cancelHref="/dashboard/projects"
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
      {Step ? (
        <Step draft={wizard.draft} onChange={wizard.update} options={options} />
      ) : (
        <ReviewStep
          sections={sections}
          draft={wizard.draft}
          options={options}
          onEdit={wizard.goTo}
        />
      )}
    </Wizard>
  );
}
