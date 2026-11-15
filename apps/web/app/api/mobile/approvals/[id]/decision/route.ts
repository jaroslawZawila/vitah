import { budgetApprovalsService } from "@repo/core";
import { readJson, withMobileClient } from "../../../../../../lib/api";

// ─── POST /api/mobile/approvals/:id/decision ──────────────────────────────────
// Body: { decision: "approve", password } or { decision: "reject", reason }
// → { approval: { id, status, decidedAt } }. A wrong password is 400
// { error: "wrong_password" } (401 would sign the app out), too many 429
// { error: "too_many_attempts" }; a request no longer waiting (withdrawn,
// replaced by a later revision, or answered otherwise) is 409
// { error: "approval_closed" }, while the same answer sent again (its reply was
// lost) is 200 with what was recorded;
// another client's is 404. What is recorded is the server's: the app sends
// only the answer.
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withMobileClient(request, async (client) =>
    budgetApprovalsService.decideApproval(client.tenantId, client.sub, id, await readJson(request)),
  );
}
