import type { ComponentType } from "react";

// A multi-step flow collects one `draft` object across steps, then shows a
// review screen before submitting. Adding a step = writing one `WizardStep`
// and adding it to the flow's step list; the engine and layout don't change.

export type StepProps<D> = {
  draft: D;
  onChange: (patch: Partial<D>) => void;
};

export type WizardStep<D> = {
  /** Stable id, used for navigation and in tests. */
  id: string;
  /** Translation key of the step title (the flow decides the namespace). */
  titleKey: string;
  /** The step's inputs. Native `required`/`min` attributes block "Next". */
  Component: ComponentType<StepProps<D>>;
  /** Read-only summary shown on the review screen. */
  Summary: ComponentType<{ draft: D }>;
  /** Whether the draft already holds everything this step requires. */
  isComplete: (draft: D) => boolean;
  /** Server error codes caused by this step's fields: the flow jumps back here. */
  errorCodes?: readonly string[];
};
