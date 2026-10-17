import { useCallback, useMemo, useState } from "react";
import { activeSteps, type WizardStep } from "./types";

// Wizard state and navigation, without any UI. Positions 0..steps.length-1
// are the steps that apply (each step's `when`, given `options` and the
// draft); position steps.length is the review screen.

export function useWizard<D, O>(allSteps: readonly WizardStep<D, O>[], initialDraft: D, options?: O) {
  const [draft, setDraft] = useState(initialDraft);
  const [position, setPosition] = useState(0);
  const steps = useMemo(() => activeSteps(allSteps, options as O, draft), [allSteps, options, draft]);

  const reviewPosition = steps.length;
  const isReview = position === reviewPosition;

  /** A position is reachable once every step before it is complete. */
  const canReach = useCallback(
    (target: number) => steps.slice(0, target).every((step) => step.isComplete(draft)),
    [steps, draft],
  );

  const update = useCallback((patch: Partial<D>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const goTo = useCallback(
    (target: number) => {
      if (target >= 0 && target <= reviewPosition && canReach(target)) setPosition(target);
    },
    [reviewPosition, canReach],
  );

  const next = useCallback(() => goTo(position + 1), [goTo, position]);
  const back = useCallback(() => setPosition((p) => Math.max(0, p - 1)), []);

  /** Returns to the step whose fields caused `code`; true if one matched. */
  const goToError = useCallback(
    (code: string) => {
      const index = steps.findIndex((step) => step.errorCodes?.includes(code));
      if (index === -1) return false;
      setPosition(index);
      return true;
    },
    [steps],
  );

  return {
    steps,
    draft,
    update,
    position,
    step: isReview ? null : (steps[position] ?? null),
    isReview,
    isFirst: position === 0,
    canReach,
    goTo,
    next,
    back,
    goToError,
  };
}
