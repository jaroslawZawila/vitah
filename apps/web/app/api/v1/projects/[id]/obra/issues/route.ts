import { constructionService } from "@repo/core";
import { readCreate, withContext } from "../../../../../../../lib/api";

// ─── /api/v1/projects/:id/obra/issues ─────────────────────────────────────────
// GET (?kind=issue|change) → ObraIssue[]
// POST { kind, occurredOn, chapterCode, description, party, partyName?,
//   costImpactCents?, scheduleImpactDays?, status? } → { issueId, number }.
//   Sent again with the same `Idempotency-Key` header (or `idempotencyKey` in
//   the body) it is one record, answered the same.
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const kind = new URL(request.url).searchParams.get("kind") ?? undefined;
  return withContext(request, (ctx) => constructionService.listIssues(ctx, id, { kind }));
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) => constructionService.createIssue(ctx, id, await readCreate(request)), 201);
}
