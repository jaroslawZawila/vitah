import type { ClientOption } from "@repo/core/contract";
import type { StepProps } from "../../components/wizard/types";

// Everything the new-project flow collects. Future steps (style, finishes, …)
// add their fields here and to createProject in packages/core.
export type ProjectDraft = {
  ref: string;
  address: string;
  /** YYYY-MM-DD, or "" when not set. */
  startDate: string;
  /** YYYY-MM-DD, or "" when not set. */
  completionDate: string;
  /** Existing client to attach, or "" for none. */
  clientId: string;
};

export const EMPTY_PROJECT_DRAFT: ProjectDraft = {
  ref: "",
  address: "",
  startDate: "",
  completionDate: "",
  clientId: "",
};

/** Data loaded on the server for the flow's steps. */
export type ProjectFlowOptions = {
  /** Admins only: whether the client step is shown. */
  canAssignClient: boolean;
  /** Clients without a project, for the client step. */
  clients: ClientOption[];
};

export type ProjectStepProps = StepProps<ProjectDraft, ProjectFlowOptions>;
