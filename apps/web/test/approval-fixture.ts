import { budgetIssueService, budgetService, constructionService, type Ctx } from "@repo/core";
import { createTestProject, createTestTenant, createTestUser } from "@repo/db/testing";

// A change to a contract, ready to ask the client about (core budget-approvals.ts):
// Rev.0 of chapter 01 accepted, Rev.1 issued, and a change (CAM-001). Mock storage first.

export const CLIENT_PASSWORD = "CasaNordica26";

export async function issuedChange(role: Ctx["role"] = "manager") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  const client = await createTestUser(tenant.id, { role: "client", password: CLIENT_PASSWORD });
  const project = await createTestProject(tenant.id, { clientUserId: client.id });
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role };
  // Built by a manager whatever `role` is: viewers only read.
  const staff: Ctx = { ...ctx, role: "manager" };
  const { revisionId: rev0 } = await budgetService.createBudget(staff, project.id, {});
  const { revision } = await budgetService.getBudget(staff, project.id, rev0);
  const c01 = revision!.chapters.find((c) => c.code === "01")!.id;
  await budgetService.addLine(staff, project.id, c01, { code: "01.01", description: "Partida", unit: "pa", quantity: 1, unitPriceCents: 100_000 });
  await budgetService.acceptRevision(staff, project.id, rev0, {}, { unissued: true });
  const { revisionId } = await budgetService.createRevision(staff, project.id);
  await budgetIssueService.issueRevision(staff, project.id, revisionId, { changeReason: "Piscina" });
  const { issueId } = await constructionService.createIssue(staff, project.id, {
    kind: "change",
    occurredOn: "2026-10-01",
    chapterCode: "01",
    description: "Piscina",
    party: "client",
  });
  return { tenant, user, client, project, ctx, staff, revisionId, issueId };
}
