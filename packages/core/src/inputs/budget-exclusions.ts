import { z } from "zod";
import { MAX_EXCLUSION_TEXT } from "../contract";
import { requiredText } from "./fields";

// The bodies of the tenant's library of "Gastos no incluidos" (../budget-exclusions).

/** A line of the library: its text, trimmed. Blank: `missing_fields`. */
export const exclusionPresetSchema = z.object({ label: requiredText(MAX_EXCLUSION_TEXT) });

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** POST /api/v1/budgets/exclusions, PATCH …/:id; the portal's library actions. */
export type ExclusionPresetInput = z.input<typeof exclusionPresetSchema>;
