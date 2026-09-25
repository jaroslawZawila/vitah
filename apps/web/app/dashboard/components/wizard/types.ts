import type { ComponentType } from "react";

// A multi-step flow collects one `draft` object across steps, then shows a
// review screen before submitting. Adding a step = writing one `WizardStep`
// and adding it to the flow's step list; the engine and layout don't change.
//
// `O` is read-only data the flow loads on the server for its steps (e.g. the
// clients to pick from, or later a catalogue of styles and finishes).

export type StepProps<D, O = undefined> = {
  draft: D;
  onChange: (patch: Partial<D>) => void;
  options: O;
};

export type WizardStep<D, O = undefined> = {
  /** Stable id, used for navigation and in tests. */
  id: string;
  /** Translation key of the step title (the flow decides the namespace). */
  titleKey: string;
  /** The step's inputs. Native `required`/`min` attributes block "Next". */
  Component: ComponentType<StepProps<D, O>>;
  /** Read-only summary shown on the review screen. */
  Summary: ComponentType<{ draft: D; options: O }>;
  /** Whether the draft already holds everything this step requires. */
  isComplete: (draft: D) => boolean;
  /** Server error codes caused by this step's fields: the flow jumps back here. */
  errorCodes?: readonly string[];
  /** Include the step only when this returns true (e.g. by role). Default: always. */
  when?: (options: O) => boolean;
};

/** The steps of a flow that apply, given its options. */
export function activeSteps<D, O>(steps: readonly WizardStep<D, O>[], options: O) {
  return steps.filter((step) => step.when?.(options) ?? true);
}
