import { subcontractorsService } from "@repo/core";
import { readJson, withContext } from "../../../../lib/api";

// ─── /api/v1/subcontractors ───────────────────────────────────────────────────
// GET  → SubcontractorListItem[]
// POST SubcontractorFields → { id }
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  return withContext(request, (ctx) => subcontractorsService.listSubcontractors(ctx));
}

export async function POST(request: Request) {
  return withContext(
    request,
    async (ctx) => subcontractorsService.createSubcontractor(ctx, await readJson(request)),
    201,
  );
}
