import type { WizardStep } from "../../../components/wizard/types";
import type { ProjectDraft } from "../draft";
import { DetailsStep, DetailsSummary } from "./DetailsStep";

// The new-project flow, in order. To add a step (e.g. style or finishes):
//   1. add its fields to ProjectDraft (../draft.ts) and to core createProject,
//   2. write a step component + summary in this folder,
//   3. add it here, with its title under newProjectPage.steps in messages.
// The review screen is added automatically after the last step.
export const PROJECT_STEPS: readonly WizardStep<ProjectDraft>[] = [
  {
    id: "details",
    titleKey: "details",
    Component: DetailsStep,
    Summary: DetailsSummary,
    isComplete: (draft) => draft.ref.trim() !== "" && draft.address.trim() !== "",
    errorCodes: ["missing_fields", "ref_exists", "invalid_date"],
  },
];
