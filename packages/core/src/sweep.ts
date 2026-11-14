import { logError } from "./log";

// ─── Sweeping now and then ───────────────────────────────────────────────────
// Rows that only pile up (login windows that have ended, idempotency keys past
// their week) are deleted by the requests themselves: one in `SWEEP_ONE_IN`
// also sweeps, and waits for it (a promise left behind may never run once a
// serverless function has answered). The request was already served: a sweep
// that fails is logged, never thrown.
// ─────────────────────────────────────────────────────────────────────────────

/** One request in this many also sweeps (a sweep reads its whole table, so not every one). */
export const SWEEP_ONE_IN = 50;

/** A number in [0, 1). */
export type Random = () => number;

let draw: Random = Math.random;

/** For tests: the draw every sweep takes from now on, to force one (0) or rule it out (1); without one, chance again. */
export function setSweepDraw(random: Random = Math.random) {
  draw = random;
}

/** On one call in `SWEEP_ONE_IN`, runs `sweep` and waits for it; a failure is logged as `event`. */
export async function sweepNowAndThen(event: string, sweep: () => Promise<unknown>) {
  if (draw() >= 1 / SWEEP_ONE_IN) return;
  try {
    await sweep();
  } catch (error) {
    logError(event, error);
  }
}
