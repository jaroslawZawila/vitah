import { FatalError } from "workflow";
import {
  extractProject,
  failGeneration,
  failureOf,
  generateGroup,
  GenerationStopped,
  isFinal,
  prepareInputs,
  saveDraft,
} from "@repo/core/budget-pipeline";

// ─── Drafting a budget with the AI ────────────────────────────────────────────
// The durable run behind "Generar el borrador" (features/budget/TECH_DESIGN.md
// §6.2). Each step is one function of @repo/core's pipeline, which stores its
// result: a retried step returns at once. Claude's rate limits and outages
// are retried (the default 3 times); a refusal, a cut-off or malformed answer,
// or a cancel stop the run. Whatever ends it, the generation row says how.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs a pipeline step. A failure no retry will fix is recorded on the
 * generation there and then (a cancel needs nothing), and ends the run.
 */
async function attempt(generationId: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (!isFinal(error)) throw error;
    if (!(error instanceof GenerationStopped)) {
      const { code, message } = failureOf(error);
      await failGeneration(generationId, code, message);
    }
    throw new FatalError(error instanceof Error ? error.message : String(error));
  }
}

async function prepare(generationId: string) {
  "use step";
  await attempt(generationId, () => prepareInputs(generationId));
}

async function extract(generationId: string) {
  "use step";
  await attempt(generationId, () => extractProject(generationId));
}

async function group(generationId: string, index: number) {
  "use step";
  await attempt(generationId, () => generateGroup(generationId, index));
}

async function save(generationId: string) {
  "use step";
  await attempt(generationId, () => saveDraft(generationId));
}

/** Whatever else ended the run (retries spent): unless it was already recorded or cancelled. */
async function fail(generationId: string, message: string) {
  "use step";
  await failGeneration(generationId, "unexpected", message);
}

export async function generateBudget(generationId: string) {
  "use workflow";
  try {
    await prepare(generationId);
    await extract(generationId);
    // The first group writes the prompt cache the others then read.
    await group(generationId, 0);
    await Promise.all([1, 2, 3].map((index) => group(generationId, index)));
    await save(generationId);
  } catch (error) {
    await fail(generationId, error instanceof Error ? error.message : String(error));
  }
}
