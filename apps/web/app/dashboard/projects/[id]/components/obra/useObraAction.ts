"use client";

import { useState, useTransition } from "react";
import type { ObraState } from "../../../../../actions/run";

/**
 * Runs the obra screens' server actions: keeps the last result (for its
 * error), whether one is running, and `after` runs only on success.
 */
export function useObraAction() {
  const [state, setState] = useState<ObraState>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<ObraState>, after?: () => void) {
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
    confirmThen(message: string, action: () => Promise<ObraState>, after?: () => void) {
      if (confirm(message)) run(action, after);
    },
    reset: () => setState(null),
  };
}
