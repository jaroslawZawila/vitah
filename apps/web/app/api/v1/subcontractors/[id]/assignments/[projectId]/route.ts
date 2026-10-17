import { subcontractorsService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../lib/api";

// ─── /api/v1/subcontractors/:id/assignments/:projectId ────────────────────────
// PUT    { chapterCodes, plannedStart?, plannedEnd?, bookOrder?, bookDate?, cssInformed? }
// DELETE → 204
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string; projectId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id, projectId } = await params;
  return withContext(request, async (ctx) =>
    subcontractorsService.assignToProject(ctx, id, projectId, await readJson(request)),
  );
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, projectId } = await params;
  return withContext(request, (ctx) => subcontractorsService.removeAssignment(ctx, id, projectId), 204);
}
