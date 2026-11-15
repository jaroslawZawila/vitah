import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { budgetApprovals, budgetRevisions, db, eq, projects, users } from "@repo/db";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import {
  budgetApprovalsService as svc,
  budgetIssueService as issue,
  budgetOptionsService as options,
  budgetService as budget,
  clientAccountService,
  constructionService,
  documentsService,
  projectClientService,
  projectsService,
  type Ctx,
} from "../src";
import { MAX_AMOUNT_CENTS } from "../src/money";
import { files } from "../src/testing";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));
vi.mock("../src/push", () => ({ sendPush: vi.fn(async () => []) }));
const { sendPush } = await import("../src/push");

const PASSWORD = "CasaNordica26";
const TOKEN = "ExponentPushToken[phone-1]";

/**
 * A project with an app client and a contract: Rev.0 of chapters 01 and 02 at
 * 1.000,00 € each (no margins: PEC 2.100,00 with chapter 20's 5 %), accepted;
 * and Rev.1, a draft with an option (a pool, 500,00 €) and its reason.
 */
async function setup(role: Ctx["role"] = "manager") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role, name: "Rubén García" });
  const client = await createTestUser(tenant.id, { role: "client", password: PASSWORD, name: "Elena Ruiz" });
  const project = await createTestProject(tenant.id, { clientUserId: client.id });
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role };
  const staff: Ctx = { ...ctx, role: "manager" };
  const { revisionId: rev0 } = await framerDraft(staff, project.id, ["01", "02"]);
  await issue.issueRevision(staff, project.id, rev0, { shareWithClient: false });
  await budget.acceptRevision(staff, project.id, rev0);
  const { revisionId: rev1 } = await budget.createRevision(staff, project.id);
  const { optionId: pool } = await options.addOption(staff, project.id, rev1, { name: "Piscina" });
  await budget.addLine(staff, project.id, pool, { description: "Vaso", unit: "ud", quantity: 1, unitPriceCents: 50_000 });
  await budget.updateRevision(staff, project.id, rev1, { changeReason: "Piscina pedida por la clienta" });
  const { issueId: change } = await constructionService.createIssue(staff, project.id, {
    kind: "change",
    occurredOn: "2026-10-01",
    chapterCode: "02",
    description: "Piscina en el jardín",
    party: "client",
    costImpactCents: 50_000,
  });
  return { tenant, user, client, project, ctx, staff, rev0, rev1, pool, change };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Rev.1 issued (its general PDF kept from the client, as the portal may) and the client asked to approve it with the pool. */
async function asked(s: Setup, body: Record<string, unknown> = {}) {
  await issue.issueRevision(s.staff, s.project.id, s.rev1, { shareWithClient: false });
  return svc.askApproval(s.staff, s.project.id, s.rev1, { message: "Te enviamos la piscina", chosenOptionIds: [s.pool], ...body });
}

const pending = (s: Setup) => svc.getClientApproval(s.tenant.id, s.client.id, s.project.id);
const approve = (s: Setup, approvalId: string, password = PASSWORD) =>
  svc.decideApproval(s.tenant.id, s.client.id, approvalId, { decision: "approve", password });
const row = async (approvalId: string) => (await db.select().from(budgetApprovals).where(eq(budgetApprovals.id, approvalId)))[0]!;
const revisionOf = async (s: Setup, revisionId: string) => (await budget.getBudget(s.staff, s.project.id, revisionId)).revision!;

/** Runs `during` while another transaction holds the project's row, then lets it go. */
async function holdingProject(projectId: string, during: () => Promise<void>) {
  let release!: () => void;
  const letGo = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const isLocked = new Promise<void>((resolve) => (locked = resolve));
  const holder = db.transaction(async (tx) => {
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("update");
    locked();
    await letGo;
  });
  await isLocked;
  try {
    await during();
  } finally {
    release();
    await holder;
  }
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.mocked(sendPush).mockReset().mockResolvedValue([]);
});

afterEach(() => vi.restoreAllMocks());

describe("linking changes to a revision", () => {
  it("links a change (CAM-) to the revision that prices it, seen from both sides", async () => {
    const s = await setup();

    await svc.linkChange(s.staff, s.project.id, s.rev1, s.change);
    await svc.linkChange(s.staff, s.project.id, s.rev1, s.change);

    expect((await revisionOf(s, s.rev1)).changes).toEqual([
      { id: s.change, number: 1, description: "Piscina en el jardín", occurredOn: "2026-10-01", costImpactCents: 50_000 },
    ]);
    const [listed] = await constructionService.listIssues(s.staff, s.project.id, { kind: "change" });
    expect(listed!.revisions).toEqual([{ id: s.rev1, number: 1 }]);

    await svc.unlinkChange(s.staff, s.project.id, s.rev1, s.change);
    expect((await revisionOf(s, s.rev1)).changes).toEqual([]);
    await expect(svc.unlinkChange(s.staff, s.project.id, s.rev1, s.change)).rejects.toMatchObject({ code: "not_found" });
  });

  it("links only changes of the project, to a revision from Rev.1 on", async () => {
    const s = await setup();
    const { issueId: incident } = await constructionService.createIssue(s.staff, s.project.id, {
      kind: "issue",
      occurredOn: "2026-10-02",
      chapterCode: "01",
      description: "Lluvia",
      party: "other",
    });
    const other = await createTestProject(s.tenant.id);

    await expect(svc.linkChange(s.staff, s.project.id, s.rev1, incident)).rejects.toMatchObject({ code: "not_a_change", status: 400 });
    await expect(svc.linkChange(s.staff, s.project.id, s.rev0, s.change)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(svc.linkChange(s.staff, other.id, s.rev1, s.change)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.linkChange({ ...s.staff, role: "viewer" }, s.project.id, s.rev1, s.change)).rejects.toMatchObject({ status: 403 });
  });

  it("freezes the links once the client is asked, and after the revision is decided", async () => {
    const s = await setup();
    await svc.linkChange(s.staff, s.project.id, s.rev1, s.change);
    await asked(s);

    await expect(svc.unlinkChange(s.staff, s.project.id, s.rev1, s.change)).rejects.toMatchObject({ code: "links_frozen", status: 409 });

    await svc.withdrawApproval(s.staff, s.project.id, s.rev1);
    await svc.unlinkChange(s.staff, s.project.id, s.rev1, s.change);
    await budget.rejectRevision(s.staff, s.project.id, s.rev1);
    await expect(svc.linkChange(s.staff, s.project.id, s.rev1, s.change)).rejects.toMatchObject({ code: "links_frozen" });
  });
});

describe("asking the client", () => {
  it("asks on the issued revision: fixes the amounts, shows the PDF and pushes the client", async () => {
    const s = await setup();
    await clientAccountService.registerPushToken(s.tenant.id, s.client.id, { token: TOKEN });
    await svc.linkChange(s.staff, s.project.id, s.rev1, s.change);

    const { approvalId } = await asked(s);

    const revision = await revisionOf(s, s.rev1);
    expect(revision.approvals).toEqual([
      expect.objectContaining({
        id: approvalId,
        status: "pending",
        message: "Te enviamos la piscina",
        chosenOptionIds: [s.pool],
        // The contract: 2.100,00; with the pool: 2.600,00.
        beforeCents: 210_000,
        afterCents: 260_000,
        vatRateBp: 1000,
        documentId: revision.pdfs.general,
        askedBy: "Rubén García",
        decidedAt: null,
      }),
    ]);
    // Kept from the client when issued, shown now: they must be able to open what they approve.
    const docs = await documentsService.listClientDocuments(s.tenant.id, s.client.id);
    expect(docs.map((d) => d.id)).toContain(revision.pdfs.general);
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendPush).mock.calls[0]![0]).toEqual([
      expect.objectContaining({ to: TOKEN, title: "Cambio para aprobar", data: { screen: "approval", projectId: s.project.id } }),
    ]);
  });

  it("follows the client's \"Mensajes del equipo\" toggle", async () => {
    const s = await setup();
    await clientAccountService.registerPushToken(s.tenant.id, s.client.id, { token: TOKEN });
    await clientAccountService.updateSettings(s.tenant.id, s.client.id, { notifications: { messages: false } });

    await asked(s);

    expect(sendPush).not.toHaveBeenCalled();
  });

  it("asks once per revision, and only what is on the table", async () => {
    const s = await setup();

    await expect(svc.askApproval(s.staff, s.project.id, s.rev1, {})).rejects.toMatchObject({ code: "not_issued", status: 409 });
    await issue.issueRevision(s.staff, s.project.id, s.rev1, { shareWithClient: false });
    await expect(svc.askApproval(s.staff, s.project.id, s.rev1, { chosenOptionIds: ["nope"] })).rejects.toMatchObject({ code: "not_found" });
    await svc.askApproval(s.staff, s.project.id, s.rev1, {});
    await expect(svc.askApproval(s.staff, s.project.id, s.rev1, {})).rejects.toMatchObject({ code: "approval_pending", status: 409 });
    // The request's state before what the body names: a 409, not the unknown option's 404.
    await expect(svc.askApproval(s.staff, s.project.id, s.rev1, { chosenOptionIds: ["nope"] })).rejects.toMatchObject({
      code: "approval_pending",
    });
    await expect(svc.askApproval({ ...s.staff, role: "viewer" }, s.project.id, s.rev1, {})).rejects.toMatchObject({ status: 403 });
    const other = await createTestTenant();
    await expect(svc.askApproval({ ...s.staff, tenantId: other.id }, s.project.id, s.rev1, {})).rejects.toMatchObject({ status: 404 });
  });

  it("needs an app client, a contract to change, and no approval already", async () => {
    const s = await setup();
    await issue.issueRevision(s.staff, s.project.id, s.rev1, { shareWithClient: false });

    await db.update(projects).set({ clientUserId: null }).where(eq(projects.id, s.project.id));
    await expect(svc.askApproval(s.staff, s.project.id, s.rev1, {})).rejects.toMatchObject({ code: "no_client", status: 409 });

    const fresh = await createTestProject(s.tenant.id, { clientUserId: s.client.id });
    const { revisionId } = await framerDraft(s.staff, fresh.id, ["01"]);
    await issue.issueRevision(s.staff, fresh.id, revisionId, { shareWithClient: false });
    await expect(svc.askApproval(s.staff, fresh.id, revisionId, {})).rejects.toMatchObject({ code: "no_contract" });
  });

  it("refuses a contract too large to store as a 400, never a database error", async () => {
    const s = await setup();
    const { optionId: big } = await options.addOption(s.staff, s.project.id, s.rev1, { name: "Ampliación" });
    await budget.addLine(s.staff, s.project.id, big, { description: "Todo", unit: "ud", quantity: 30, unitPriceCents: 100_000_000 });
    // 30 M €: past what an amount may be (and a 32-bit column holds).
    expect(30 * 100_000_000).toBeGreaterThan(MAX_AMOUNT_CENTS);
    await issue.issueRevision(s.staff, s.project.id, s.rev1, { shareWithClient: false });

    await expect(svc.askApproval(s.staff, s.project.id, s.rev1, { chosenOptionIds: [big] })).rejects.toMatchObject({
      code: "invalid_input",
      status: 400,
    });
    expect(await db.$count(budgetApprovals)).toBe(0);
  });

  it("never leaves a request waiting on a revision a later one was issued after, asked at the same time", async () => {
    const s = await setup();
    await issue.issueRevision(s.staff, s.project.id, s.rev1, { shareWithClient: false });
    const { revisionId: rev2 } = await budget.createRevision(s.staff, s.project.id);

    await Promise.allSettled([
      svc.askApproval(s.staff, s.project.id, s.rev1, {}),
      issue.issueRevision(s.staff, s.project.id, rev2, { changeReason: "Otra piscina", shareWithClient: false }),
    ]);

    expect((await revisionOf(s, rev2)).status).toBe("issued");
    expect(await db.select().from(budgetApprovals).where(eq(budgetApprovals.status, "pending"))).toEqual([]);
    expect(await pending(s)).toBeNull();
  });

  it("asks and issues one at a time per project: both wait for the project's row", async () => {
    const s = await setup();
    await issue.issueRevision(s.staff, s.project.id, s.rev1, { shareWithClient: false });
    const { revisionId: rev2 } = await budget.createRevision(s.staff, s.project.id);

    const settled: string[] = [];
    const running: Promise<unknown>[] = [];
    await holdingProject(s.project.id, async () => {
      running.push(
        svc.askApproval(s.staff, s.project.id, s.rev1, {}).then(
          () => settled.push("asked"),
          () => settled.push("ask refused"),
        ),
        issue
          .issueRevision(s.staff, s.project.id, rev2, { changeReason: "Otra piscina", shareWithClient: false })
          .then(() => settled.push("issued")),
      );
      // Neither gets past the row another write of the project holds.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(settled).toEqual([]);
    });
    await Promise.all(running);

    // Whichever went first, Rev.2 is issued and nothing waits on Rev.1.
    expect(settled).toContain("issued");
    expect((await revisionOf(s, rev2)).status).toBe("issued");
    expect(await db.select().from(budgetApprovals).where(eq(budgetApprovals.status, "pending"))).toEqual([]);
  });

  it("stops waiting when the project is deleted", async () => {
    const s = await setup();
    const { approvalId } = await asked(s);

    await projectsService.deleteProject({ ...s.staff, role: "admin" }, s.project.id);

    expect((await row(approvalId)).status).toBe("lapsed");
  });

  it("keeps the PDF being approved in the client's app", async () => {
    const s = await setup();
    await asked(s);
    const pdf = (await revisionOf(s, s.rev1)).pdfs.general!;
    const hide = () => documentsService.setDocumentVisibility(s.staff, s.project.id, pdf, { visibleToClient: false });

    await expect(hide()).rejects.toMatchObject({ code: "approval_document", status: 409 });
    expect((await documentsService.listClientDocuments(s.tenant.id, s.client.id)).map((d) => d.id)).toContain(pdf);

    // Once the request is withdrawn, staff choose again.
    await svc.withdrawApproval(s.staff, s.project.id, s.rev1);
    await expect(hide()).resolves.toEqual({ documentId: pdf });
  });

  it("withdraws the request waiting, and the client sees nothing more", async () => {
    const s = await setup();
    const { approvalId } = await asked(s);

    await svc.withdrawApproval(s.staff, s.project.id, s.rev1);

    expect(await pending(s)).toBeNull();
    expect(await row(approvalId)).toMatchObject({ status: "withdrawn", closedById: s.user.id, decidedAt: null });
    await expect(approve(s, approvalId)).rejects.toMatchObject({ code: "approval_closed", status: 409 });
    await expect(svc.withdrawApproval(s.staff, s.project.id, s.rev1)).rejects.toMatchObject({ code: "approval_closed" });
    // Asked again, a new request.
    await expect(svc.askApproval(s.staff, s.project.id, s.rev1, {})).resolves.toMatchObject({ approvalId: expect.any(String) });
  });
});

describe("the client's answer", () => {
  it("shows the client what they are asked, from what was fixed when asked", async () => {
    const s = await setup();
    await svc.linkChange(s.staff, s.project.id, s.rev1, s.change);
    const { approvalId } = await asked(s);

    expect(await pending(s)).toEqual({
      id: approvalId,
      revisionNumber: 1,
      reference: "036/2026",
      changeReason: "Piscina pedida por la clienta",
      message: "Te enviamos la piscina",
      askedAt: expect.any(String),
      beforeCents: 210_000,
      afterCents: 260_000,
      differenceCents: 50_000,
      vatRateBp: 1000,
      documentId: (await revisionOf(s, s.rev1)).pdfs.general,
      changes: [{ number: 1, description: "Piscina en el jardín" }],
      options: [{ name: "Piscina", priceCents: 50_000 }],
    });
    // The default home is the same one.
    expect(await svc.getClientApproval(s.tenant.id, s.client.id)).toMatchObject({ id: approvalId });
  });

  it("keeps the changes as the client was shown them, whatever staff edit after", async () => {
    const s = await setup();
    await svc.linkChange(s.staff, s.project.id, s.rev1, s.change);
    const { approvalId } = await asked(s);
    const shown = { id: s.change, number: 1, description: "Piscina en el jardín", occurredOn: "2026-10-01", costImpactCents: 50_000 };
    const edit = (description: string) => constructionService.updateIssue(s.staff, s.project.id, s.change, { description, costImpactCents: 90_000 });

    // Edited while the client is asked: they still see, and staff still read, what was asked.
    await edit("Piscina 10×5");
    expect((await pending(s))!.changes).toEqual([{ number: 1, description: "Piscina en el jardín" }]);
    expect((await revisionOf(s, s.rev1)).changes).toEqual([shown]);

    // And after they approved it: the record of what they approved.
    await approve(s, approvalId);
    await edit("Piscina 12×6");
    expect((await revisionOf(s, s.rev1)).changes).toEqual([shown]);

    // A revision without a request standing shows its links as they are now.
    await budget.acceptRevision(s.staff, s.project.id, s.rev1, { chosenOptionIds: [s.pool] });
    const { revisionId: rev2 } = await budget.createRevision(s.staff, s.project.id);
    await svc.linkChange(s.staff, s.project.id, rev2, s.change);
    expect((await revisionOf(s, rev2)).changes).toEqual([{ ...shown, description: "Piscina 12×6", costImpactCents: 90_000 }]);
  });

  it("approves with the client's password, once; the amounts are the server's", async () => {
    const s = await setup();
    const { approvalId } = await asked(s);

    await expect(approve(s, approvalId, "wrong-password")).rejects.toMatchObject({ code: "wrong_password", status: 400 });
    await expect(svc.decideApproval(s.tenant.id, s.client.id, approvalId, { decision: "approve" })).rejects.toMatchObject({
      code: "missing_fields",
    });
    expect((await row(approvalId)).status).toBe("pending");

    const reply = await svc.decideApproval(s.tenant.id, s.client.id, approvalId, {
      decision: "approve",
      password: PASSWORD,
      // What an app might send is never what is recorded.
      beforeCents: 1,
      afterCents: 2,
      decidedById: s.user.id,
    });

    expect(reply).toEqual({ approval: { id: approvalId, status: "approved", decidedAt: expect.any(String) } });
    expect(await row(approvalId)).toMatchObject({
      status: "approved",
      decidedById: s.client.id,
      beforeCents: 210_000,
      afterCents: 260_000,
      rejectReason: null,
    });
    expect(await pending(s)).toBeNull();
    // Staff see who answered and when; the revision stays issued until they register the acceptance.
    const revision = await revisionOf(s, s.rev1);
    expect(revision.status).toBe("issued");
    expect(revision.approvals[0]).toMatchObject({ status: "approved", decidedBy: "Elena Ruiz", decidedOn: expect.any(String) });
    await expect(svc.askApproval(s.staff, s.project.id, s.rev1, {})).rejects.toMatchObject({ code: "already_approved" });
  });

  it("answers a retry of the same decision with what was recorded, and nothing else", async () => {
    const s = await setup();
    await clientAccountService.registerPushToken(s.tenant.id, s.client.id, { token: TOKEN });
    const { approvalId } = await asked(s);
    const first = await approve(s, approvalId);
    const counters = async () => (await db.select({ obra: projects.obraRev }).from(projects).where(eq(projects.id, s.project.id)))[0]!.obra;
    const before = await counters();
    vi.mocked(sendPush).mockClear();

    // The reply to the first was lost: the same answer again.
    expect(await approve(s, approvalId)).toEqual(first);
    // Still checked as the first: the password, and only the same decision by the same client.
    await expect(approve(s, approvalId, "wrong-password")).rejects.toMatchObject({ code: "wrong_password" });
    await expect(svc.decideApproval(s.tenant.id, s.client.id, approvalId, { decision: "reject", reason: "No" })).rejects.toMatchObject({
      code: "approval_closed",
      status: 409,
    });
    expect(await counters()).toBe(before);
    expect(sendPush).not.toHaveBeenCalled();
    expect(await row(approvalId)).toMatchObject({ status: "approved", decidedAt: new Date(first.approval.decidedAt) });

    // A rejection, the same.
    const t = await setup();
    const { approvalId: second } = await asked(t);
    const rejected = await svc.decideApproval(t.tenant.id, t.client.id, second, { decision: "reject", reason: "Muy cara" });
    expect(await svc.decideApproval(t.tenant.id, t.client.id, second, { decision: "reject", reason: "Muy cara" })).toEqual(rejected);
    await expect(approve(t, second)).rejects.toMatchObject({ code: "approval_closed" });
  });

  it("rejects with a reason, which staff see; the revision stays issued", async () => {
    const s = await setup();
    const { approvalId } = await asked(s);

    await expect(svc.decideApproval(s.tenant.id, s.client.id, approvalId, { decision: "reject" })).rejects.toMatchObject({
      code: "missing_fields",
    });
    await expect(svc.decideApproval(s.tenant.id, s.client.id, approvalId, { decision: "maybe" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await svc.decideApproval(s.tenant.id, s.client.id, approvalId, { decision: "reject", reason: "  Muy cara  " });

    const revision = await revisionOf(s, s.rev1);
    expect(revision.status).toBe("issued");
    expect(revision.approvals[0]).toMatchObject({ status: "rejected", rejectReason: "Muy cara", decidedBy: "Elena Ruiz" });
    // Staff may rework it and ask again.
    await expect(svc.askApproval(s.staff, s.project.id, s.rev1, {})).resolves.toBeTruthy();
  });

  it("counts wrong passwords in the client's password throttle", async () => {
    const s = await setup();
    const { approvalId } = await asked(s);

    for (let i = 0; i < 10; i++) await expect(approve(s, approvalId, "wrong")).rejects.toMatchObject({ code: "wrong_password" });
    await expect(approve(s, approvalId)).rejects.toMatchObject({ code: "too_many_attempts", status: 429 });
    expect((await row(approvalId)).status).toBe("pending");
  });

  it("is the asked client's alone: not another client's, another home's or another tenant's", async () => {
    const s = await setup();
    const { approvalId } = await asked(s);
    const stranger = await createTestUser(s.tenant.id, { role: "client", password: PASSWORD });
    const otherHome = await createTestProject(s.tenant.id, { clientUserId: s.client.id });
    const otherTenant = await createTestTenant();

    await expect(svc.getClientApproval(s.tenant.id, stranger.id, s.project.id)).rejects.toMatchObject({ code: "project_not_found" });
    expect(await svc.getClientApproval(s.tenant.id, stranger.id)).toBeNull();
    expect(await svc.getClientApproval(s.tenant.id, s.client.id, otherHome.id)).toBeNull();
    expect(await svc.getClientApproval(otherTenant.id, s.client.id)).toBeNull();
    for (const [tenantId, clientId] of [
      [s.tenant.id, stranger.id],
      [otherTenant.id, s.client.id],
    ] as const) {
      await expect(svc.decideApproval(tenantId, clientId, approvalId, { decision: "approve", password: PASSWORD })).rejects.toMatchObject({
        code: "not_found",
        status: 404,
      });
    }
    expect((await row(approvalId)).status).toBe("pending");
  });

  it("lapses when the home's client changes: the new client is asked anew", async () => {
    const s = await setup();
    const admin: Ctx = { ...s.staff, userId: (await createTestUser(s.tenant.id, { role: "admin" })).id, role: "admin" };
    const { approvalId } = await asked(s);
    const other = await createTestUser(s.tenant.id, { role: "client", password: PASSWORD });

    await projectClientService.unassignProjectClient(admin, s.project.id);
    expect(await row(approvalId)).toMatchObject({ status: "lapsed", closedById: admin.userId });
    await expect(approve(s, approvalId)).rejects.toMatchObject({ code: "not_found" });

    await projectClientService.assignProjectClient(admin, s.project.id, { clientId: other.id });
    // Not the new client's: it was asked of the other one; staff may ask them now.
    expect(await svc.getClientApproval(s.tenant.id, other.id)).toBeNull();
    const { approvalId: anew } = await svc.askApproval(s.staff, s.project.id, s.rev1, {});
    expect(await svc.getClientApproval(s.tenant.id, other.id)).toMatchObject({ id: anew });
  });

  it("lapses one asked of a client whose account went, once another client is attached", async () => {
    const s = await setup();
    const admin: Ctx = { ...s.staff, userId: (await createTestUser(s.tenant.id, { role: "admin" })).id, role: "admin" };
    const { approvalId } = await asked(s);
    // A hand-run delete of the account: its keys empty the home's client and the request's.
    await db.delete(users).where(eq(users.id, s.client.id));
    expect(await row(approvalId)).toMatchObject({ status: "pending", clientUserId: null });

    const other = await createTestUser(s.tenant.id, { role: "client" });
    await projectClientService.assignProjectClient(admin, s.project.id, { clientId: other.id });
    expect((await row(approvalId)).status).toBe("lapsed");
  });
});

describe("when a request closes on its own", () => {
  it("lapses when a later revision is issued; an answered one stays as it is", async () => {
    const s = await setup();
    const { approvalId } = await asked(s);
    const { revisionId: rev2 } = await budget.createRevision(s.staff, s.project.id);

    await issue.issueRevision(s.staff, s.project.id, rev2, { changeReason: "Otra piscina", shareWithClient: false });

    expect(await row(approvalId)).toMatchObject({ status: "lapsed", closedById: s.user.id });
    expect(await pending(s)).toBeNull();
    await expect(approve(s, approvalId)).rejects.toMatchObject({ code: "approval_closed" });
    // Rev.1 is no longer the newest one issued.
    await expect(svc.askApproval(s.staff, s.project.id, s.rev1, {})).rejects.toMatchObject({ code: "not_newest" });
  });

  it("keeps an approval when a later revision is issued", async () => {
    const s = await setup();
    const { approvalId } = await asked(s);
    await approve(s, approvalId);
    const { revisionId: rev2 } = await budget.createRevision(s.staff, s.project.id);

    await issue.issueRevision(s.staff, s.project.id, rev2, { changeReason: "Otra piscina", shareWithClient: false });

    expect((await row(approvalId)).status).toBe("approved");
  });

  it("lapses when staff accept or reject by hand", async () => {
    const s = await setup();
    const { approvalId } = await asked(s);
    await budget.rejectRevision(s.staff, s.project.id, s.rev1);
    expect((await row(approvalId)).status).toBe("lapsed");
    await expect(approve(s, approvalId)).rejects.toMatchObject({ code: "approval_closed" });

    const { revisionId: rev2 } = await budget.createRevision(s.staff, s.project.id);
    await issue.issueRevision(s.staff, s.project.id, rev2, { changeReason: "Sin piscina", shareWithClient: false });
    const { approvalId: second } = await svc.askApproval(s.staff, s.project.id, rev2, {});
    await budget.acceptRevision(s.staff, s.project.id, rev2);
    expect((await row(second)).status).toBe("lapsed");
    // Registered by hand without the client's answer: no approval as its proof.
    expect((await revisionOf(s, rev2)).acceptedApprovalId).toBeNull();
  });
});

describe("a request older code left open", () => {
  it("is neither shown nor answerable once a later revision is issued", async () => {
    const s = await setup();
    const { approvalId } = await asked(s);
    const { revisionId: rev2 } = await budget.createRevision(s.staff, s.project.id);
    await issue.issueRevision(s.staff, s.project.id, rev2, { changeReason: "Otra piscina", shareWithClient: false });
    // Code from before lapsing (a rollback) would have left it waiting.
    await db.update(budgetApprovals).set({ status: "pending", closedAt: null, closedById: null }).where(eq(budgetApprovals.id, approvalId));

    expect(await pending(s)).toBeNull();
    await expect(approve(s, approvalId)).rejects.toMatchObject({ code: "approval_closed" });

    // And on a revision no longer issued.
    await db.update(budgetRevisions).set({ status: "draft" }).where(eq(budgetRevisions.id, rev2));
    await db.update(budgetRevisions).set({ status: "rejected" }).where(eq(budgetRevisions.id, s.rev1));
    expect(await pending(s)).toBeNull();
    await expect(approve(s, approvalId)).rejects.toMatchObject({ code: "approval_closed" });
  });
});

describe("registering the acceptance", () => {
  it("never names an approval by a client the home no longer has", async () => {
    const s = await setup();
    const admin: Ctx = { ...s.staff, userId: (await createTestUser(s.tenant.id, { role: "admin" })).id, role: "admin" };
    const { approvalId } = await asked(s);
    await approve(s, approvalId);
    const other = await createTestUser(s.tenant.id, { role: "client" });
    await projectClientService.unassignProjectClient(admin, s.project.id);
    await projectClientService.assignProjectClient(admin, s.project.id, { clientId: other.id });

    await budget.acceptRevision(s.staff, s.project.id, s.rev1, { chosenOptionIds: [s.pool] });

    expect((await revisionOf(s, s.rev1)).acceptedApprovalId).toBeNull();
    expect((await row(approvalId)).status).toBe("approved");
  });

  it("names the client's approval as its proof when the options are the ones approved", async () => {
    const s = await setup();
    const { approvalId } = await asked(s);
    await approve(s, approvalId);

    await budget.acceptRevision(s.staff, s.project.id, s.rev1, { chosenOptionIds: [s.pool] });

    expect(await revisionOf(s, s.rev1)).toMatchObject({ status: "accepted", acceptedApprovalId: approvalId, contractTotalCents: 260_000 });
  });

  it("doesn't when staff register other options", async () => {
    const s = await setup();
    const { approvalId } = await asked(s);
    await approve(s, approvalId);

    await budget.acceptRevision(s.staff, s.project.id, s.rev1, { chosenOptionIds: [] });

    expect((await revisionOf(s, s.rev1)).acceptedApprovalId).toBeNull();
    expect((await row(approvalId)).status).toBe("approved");
  });
});
