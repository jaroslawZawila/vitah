"use client";

import { useState, useTransition } from "react";
import type { ActionState, ObraState } from "../../../../../actions/run";

/**
 * Runs the obra screens' server actions: keeps the last result (for its
 * error), whether one is running, and `after` runs only on success. `S` is
 * the actions' state type (the obra's errors by default).
 */
export function useObraAction<S extends ActionState<string> = ObraState>() {
  const [state, setState] = useState<S | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<S>, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      setState(result);
      if (result?.success) after?.();
    });
  }

  return {
    state,
    pending,
    run,
    /** `run` once the user confirms `message`. */
    confirmThen(message: string, action: () => Promise<S>, after?: () => void) {
      if (confirm(message)) run(action, after);
    },
    reset: () => setState(null),
  };
}
