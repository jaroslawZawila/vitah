import { constructionService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../../lib/api";

// ─── /api/v1/projects/:id/obra/chapters/:code/control ─────────────────────────
// GET → ControlChapterDetail (its dates and history, hito, issues, photos and
//   lines' executed %)
// PATCH { actualStart?, actualEnd?, note? } → { state, invoiceRequested }:
//   corrects the recorded dates (each YYYY-MM-DD, or null to clear it)
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string; code: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, code } = await params;
  return withContext(request, (ctx) => constructionService.getControlChapter(ctx, id, code));
}

export async function PATCH(request: Request, { params }: Params) {
  const { id, code } = await params;
  return withContext(request, async (ctx) => constructionService.correctChapter(ctx, id, code, await readJson(request)));
}
