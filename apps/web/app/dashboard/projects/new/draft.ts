// Everything the new-project flow collects. Future steps (style, finishes, …)
// add their fields here and to createProject in packages/core.
export type ProjectDraft = {
  ref: string;
  address: string;
  /** YYYY-MM-DD, or "" when not set. */
  startDate: string;
  /** YYYY-MM-DD, or "" when not set. */
  completionDate: string;
};

export const EMPTY_PROJECT_DRAFT: ProjectDraft = {
  ref: "",
  address: "",
  startDate: "",
  completionDate: "",
};
