import { z } from "zod";
import { OBRA_STAGES } from "../contract";

// The body of ../obra's write: the stage set by hand.

/** One of the eight stages; anything else (or nothing) is `invalid_stage`. */
export const stageSchema = z.object({ stage: z.literal(OBRA_STAGES, { error: "invalid_stage" }) });

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** PUT /api/v1/projects/:id/obra, setObraStageAction. */
export type ObraStageInput = z.input<typeof stageSchema>;
