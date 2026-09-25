import type { WizardStep } from "../../../components/wizard/types";
import type { ProjectDraft, ProjectFlowOptions } from "../draft";
import { ClientStep, ClientSummary } from "./ClientStep";
import { DetailsStep, DetailsSummary } from "./DetailsStep";

// The new-project flow, in order. To add a step (e.g. style or finishes):
//   1. add its fields to ProjectDraft (../draft.ts) and to core createProject,
//      and any server data it needs to ProjectFlowOptions (loaded in ../page.tsx),
//   2. write a step component + summary in this folder,
//   3. add it here, with its title under newProjectPage.steps in messages.
// The review screen is added automatically after the last step.
export const PROJECT_STEPS: readonly WizardStep<ProjectDraft, ProjectFlowOptions>[] = [
  {
    id: "details",
    titleKey: "details",
    Component: DetailsStep,
    Summary: DetailsSummary,
    isComplete: (draft) => draft.ref.trim() !== "" && draft.address.trim() !== "",
    errorCodes: ["missing_fields", "ref_exists", "invalid_date"],
  },
  {
    id: "client",
    titleKey: "client",
    Component: ClientStep,
    Summary: ClientSummary,
    // Optional: "no client" is a valid choice.
    isComplete: () => true,
    errorCodes: ["client_not_found", "client_has_project", "forbidden"],
    when: (options) => options.canAssignClient,
  },
];
