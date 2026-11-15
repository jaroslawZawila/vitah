import { beforeEach, describe, expect, it, vi } from "vitest";
import { files } from "@repo/core/testing";
import { resetDatabase } from "@repo/db/testing";
import { issuedChange } from "../../test/approval-fixture";
import { TO_LOGIN } from "../../test/navigation";
import { signInAs } from "../../test/session";
import { askApprovalAction, getProjectBudget, linkChangeAction, unlinkChangeAction, withdrawApprovalAction } from "./budget";

// The services are covered in packages/core (budget-approvals.test.ts); these tests cover the adapter.
// The client has no phone registered: nothing is pushed.

vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

const revision = async (projectId: string, revisionId: string) => (await getProjectBudget(projectId, revisionId))!.budget.revision!;

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.mocked(revalidatePath).mockClear();
});

describe("asking the client to approve a change", () => {
  it("links the change, asks, and withdraws, refreshing the project's pages", async () => {
    const { project, ctx, revisionId, issueId } = await issuedChange();
    signInAs(ctx);

    expect(await linkChangeAction(project.id, revisionId, issueId)).toEqual({ success: true });
    expect(await askApprovalAction(project.id, revisionId, { message: "La piscina" })).toEqual({ success: true });
    expect(await askApprovalAction(project.id, revisionId, {})).toEqual({ error: "approval_pending" });
    expect(await unlinkChangeAction(project.id, revisionId, issueId)).toEqual({ error: "links_frozen" });

    const asked = await revision(project.id, revisionId);
    expect(asked.changes.map((c) => c.number)).toEqual([1]);
    expect(asked.approvals).toEqual([expect.objectContaining({ status: "pending", message: "La piscina" })]);
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`, "layout");

    expect(await withdrawApprovalAction(project.id, revisionId)).toEqual({ success: true });
    expect((await revision(project.id, revisionId)).approvals[0]!.status).toBe("withdrawn");
    expect(await unlinkChangeAction(project.id, revisionId, issueId)).toEqual({ success: true });
  });

  it("is for admins and managers; signed out, the login page", async () => {
    const { project, ctx, revisionId, issueId } = await issuedChange("viewer");
    signInAs(ctx);
    expect(await askApprovalAction(project.id, revisionId, {})).toEqual({ error: "forbidden" });
    expect(await linkChangeAction(project.id, revisionId, issueId)).toEqual({ error: "forbidden" });

    signInAs(null);
    await expect(withdrawApprovalAction(project.id, revisionId)).rejects.toEqual(TO_LOGIN);
  });
});
