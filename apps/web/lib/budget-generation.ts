import { getRun, start } from "workflow/api";
import { budgetGenerationsService as generations, type Ctx } from "@repo/core";
import { failGeneration } from "@repo/core/budget-pipeline";
import { generateBudget } from "../workflows/generate-budget";

// Starting and stopping the AI's budget run (a durable workflow), shared by
// the server actions and /api/v1.

/** Records the run and starts its workflow; a run that can't start is marked failed, not left queued. */
export async function startBudgetGeneration(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  const { generationId } = await generations.startGeneration(ctx, projectId, input);
  try {
    const run = await start(generateBudget, [generationId]);
    await generations.setWorkflowRun(generationId, run.runId);
  } catch (error) {
    await failGeneration(generationId, "unexpected", error instanceof Error ? error.message : String(error));
    throw error;
  }
  return { generationId };
}

export async function cancelBudgetGeneration(ctx: Ctx, projectId: string, generationId: string) {
  const { workflowRunId } = await generations.cancelGeneration(ctx, projectId, generationId);
  // The run also checks the row before each step, so a failed cancel only costs a step.
  if (workflowRunId) await getRun(workflowRunId).cancel().catch(() => {});
  return { generationId };
}
