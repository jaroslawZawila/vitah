import { budgetService, type Ctx } from "../src";

/**
 * A FRAMER draft (twenty chapters) with one line of 1 × `cents` in each of
 * `codes`; chapter 20 then holds 5 % of them. No margins unless given (in %),
 * so the PEC is the lines' sum.
 */
export async function framerDraft(
  ctx: Ctx,
  projectId: string,
  codes: string[],
  cents = 100_000,
  { overheadPct = 0, profitPct = 0 } = {},
) {
  const { revisionId } = await budgetService.createBudget(ctx, projectId, { reference: "036/2026" });
  await budgetService.updateRevision(ctx, projectId, revisionId, { overheadPct, profitPct });
  const { revision } = await budgetService.getBudget(ctx, projectId, revisionId);
  const ids = new Map(revision!.chapters.map((c) => [c.code, c.id]));
  const chapterId = (code: string) => ids.get(code)!;
  for (const code of codes) {
    await budgetService.addLine(ctx, projectId, chapterId(code), {
      code: `${code}.01`,
      description: `Partida ${code}.01`,
      unit: "pa",
      quantity: 1,
      unitPriceCents: cents,
    });
  }
  return { revisionId, chapterId };
}
