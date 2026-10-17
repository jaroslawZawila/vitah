import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { db, eq, obraInvoiceRequests, obraProgressEvents } from "@repo/db";
import {
  budgetService,
  constructionService as svc,
  hitosService,
  obraService,
  purchasingService,
  subcontractorsService,
  type Ctx,
} from "../src";
import { files } from "../src/testing";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));

/**
 * A project with dates, a client and an accepted budget of chapters 01–03 at
 * 1.000 € each (no margins), with the standard hitos: H2 closes 01 and 02, H3 03.
 */
async function setup(role: Ctx["role"] = "manager") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role, name: "Rubén García" });
  const client = await createTestUser(tenant.id, { role: "client", name: "Marta Ruiz" });
  const project = await createTestProject(tenant.id, {
    clientUserId: client.id,
    startDate: new Date("2026-06-01T00:00:00Z"),
    completionDate: new Date("2027-03-31T00:00:00Z"),
  });
  const admin: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" };
  const { revisionId } = await framerDraft(admin, project.id, ["01", "02", "03"]);
  await budgetService.acceptRevision(admin, project.id, revisionId);
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role };
  return { tenant, project, ctx, admin, revisionId };
}

const chapter = async (ctx: Ctx, projectId: string, code: string) =>
  (await svc.getControl(ctx, projectId)).chapters.find((c) => c.code === code)!;

const milestone = async (ctx: Ctx, projectId: string, code: string) =>
  (await svc.getControl(ctx, projectId)).milestones.find((m) => m.code === code)!;

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

describe("getControl", () => {
  it("lists the contract's chapters, pending, with planned dates and the project's figures", async () => {
    const { ctx, project } = await setup();
    const control = await svc.getControl(ctx, project.id);

    // Chapter 20 (the contingency) is a reserve, not a chapter to build.
    expect(control.chapters.map((c) => [c.code, c.state, c.hitoCode])).toEqual([
      ["01", "pending", "H2"],
      ["02", "pending", "H2"],
      ["03", "pending", "H3"],
    ]);
    expect(control.project).toMatchObject({ ref: project.ref, clientName: "Marta Ruiz", startDate: "2026-06-01", stage: 1 });
    const first = control.chapters[0]!;
    expect(first.plannedStart).toBe("2026-06-01");
    expect(first.plannedEnd! < "2027-03-31").toBe(true);
    expect(first).toMatchObject({ costCents: 100_000, contractedCents: null, deviationCents: null, actualDays: null });
    expect(control.cost).toEqual({
      budgetedCents: 300_000,
      contractedCents: 0,
      contractedCostCents: 0,
      deviationCents: 0,
      deviationBp: 0,
      contingencyCents: 15_000,
    });
    expect(control.sales).toEqual({
      contractCents: 315_000,
      invoicedCents: 0,
      collectedCents: 0,
      outstandingCents: 0,
      toInvoiceCents: 315_000,
    });
    expect(control.milestones.map((m) => [m.code, m.state])).toContainEqual(["H2", "pending"]);
    expect(control.sources).toEqual({ planning: "mock", purchasing: "live" });
    expect(control.lateDeliveries).toEqual([]);
    expect(control.reviewPending).toBe(false);
  });

  it("reads the invoices and payments Sales recorded on the hitos", async () => {
    const { ctx, admin, project } = await setup();
    const h0 = (await hitosService.listHitos(admin, project.id)).find((h) => h.code === "H0")!;
    await hitosService.registerPayment(admin, project.id, h0.id, { paidOn: "2026-02-03" });

    const control = await svc.getControl(ctx, project.id);
    expect(control.milestones[0]).toMatchObject({ code: "H0", state: "collected", invoicedCents: 15_750, collectedCents: 15_750, outstandingCents: 0 });
    expect(control.sales).toMatchObject({ invoicedCents: 15_750, collectedCents: 15_750, toInvoiceCents: 299_250 });
  });

  it("keeps tenants apart", async () => {
    const { project } = await setup();
    const other = await createTestTenant();
    const stranger: Ctx = { tenantId: other.id, userId: (await createTestUser(other.id)).id, role: "admin" };

    await expect(svc.getControl(stranger, project.id)).rejects.toMatchObject({ code: "project_not_found" });
    await expect(svc.getCosts(stranger, project.id)).rejects.toMatchObject({ code: "project_not_found" });
    await expect(svc.listIssues(stranger, project.id)).rejects.toMatchObject({ code: "project_not_found" });
    await expect(svc.startChapter(stranger, project.id, "01", { date: "2026-10-01" })).rejects.toMatchObject({
      code: "project_not_found",
    });
  });
});

describe("getControlHeader", () => {
  it("gives the pages' header and pickers cheaply: ref, stage, open issues, contract chapters", async () => {
    const { ctx, project } = await setup();
    await svc.createIssue(ctx, project.id, { kind: "issue", occurredOn: "2026-10-01", chapterCode: "02", description: "Lluvia", party: "other" });

    expect(await svc.getControlHeader(ctx, project.id)).toEqual({
      ref: project.ref,
      stage: 1,
      budgetNumber: 0,
      openIssues: 1,
      chapters: [
        { code: "01", name: expect.any(String) },
        { code: "02", name: expect.any(String) },
        { code: "03", name: expect.any(String) },
      ],
      today: "2026-10-17",
    });
    const other = await createTestTenant();
    const stranger: Ctx = { tenantId: other.id, userId: (await createTestUser(other.id)).id, role: "admin" };
    await expect(svc.getControlHeader(stranger, project.id)).rejects.toMatchObject({ code: "project_not_found" });
  });
});

describe("start and finish", () => {
  it("moves a chapter pending → in progress → finished by its actual dates, logging who and when", async () => {
    const { ctx, project } = await setup();

    expect(await svc.startChapter(ctx, project.id, "01", { date: "2026-06-03" })).toEqual({ state: "in_progress" });
    expect(await chapter(ctx, project.id, "01")).toMatchObject({
      state: "in_progress",
      actualStart: "2026-06-03",
      startDelayDays: 2,
      actualDays: 137,
    });

    expect(await svc.finishChapter(ctx, project.id, "01", { date: "2026-06-20" })).toEqual({
      state: "finished",
      invoiceRequested: null,
    });
    const finished = await chapter(ctx, project.id, "01");
    expect(finished).toMatchObject({ state: "finished", actualEnd: "2026-06-20", actualDays: 18, overdueDays: null });

    const { events } = await svc.getControlChapter(ctx, project.id, "01");
    expect(events.map((e) => [e.kind, e.newDate, e.recordedBy])).toEqual([
      ["finish", "2026-06-20", "Rubén García"],
      ["start", "2026-06-03", "Rubén García"],
    ]);
  });

  it("refuses a start or finish out of turn, a date after today or before the start", async () => {
    const { ctx, project } = await setup();

    await expect(svc.finishChapter(ctx, project.id, "01", { date: "2026-10-01" })).rejects.toMatchObject({ code: "invalid_state" });
    await expect(svc.startChapter(ctx, project.id, "01", { date: "2026-10-18" })).rejects.toMatchObject({ code: "invalid_date" });
    await expect(svc.startChapter(ctx, project.id, "01", { date: "17/10/2026" })).rejects.toMatchObject({ code: "invalid_date" });
    await expect(svc.startChapter(ctx, project.id, "20", { date: "2026-10-01" })).rejects.toMatchObject({ code: "not_found" });

    await svc.startChapter(ctx, project.id, "01", { date: "2026-10-01" });
    await expect(svc.startChapter(ctx, project.id, "01", { date: "2026-10-02" })).rejects.toMatchObject({ code: "invalid_state" });
    await expect(svc.finishChapter(ctx, project.id, "01", { date: "2026-09-30" })).rejects.toMatchObject({ code: "invalid_date" });
    expect((await chapter(ctx, project.id, "01")).state).toBe("in_progress");
  });

  it("lets viewers read but not record", async () => {
    const { tenant, project } = await setup();
    const viewer: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "viewer" })).id, role: "viewer" };

    await expect(svc.startChapter(viewer, project.id, "01", { date: "2026-10-01" })).rejects.toMatchObject({ code: "forbidden" });
    expect((await svc.getControl(viewer, project.id)).chapters).toHaveLength(3);
  });

  it("shows a chapter past its planned end as overdue, without changing its state", async () => {
    const { ctx, project } = await setup();
    const planned = await chapter(ctx, project.id, "01");
    await svc.startChapter(ctx, project.id, "01", { date: planned.plannedStart! });

    const late = await chapter(ctx, project.id, "01");
    expect(late.state).toBe("in_progress");
    expect(late.overdueDays).toBeGreaterThan(0);
  });

  it("counts a finished chapter as built in full for the hitos and the client's app", async () => {
    const { ctx, project } = await setup();
    await svc.startChapter(ctx, project.id, "01", { date: "2026-06-01" });
    await svc.finishChapter(ctx, project.id, "01", { date: "2026-06-12" });

    const obra = await obraService.getObra(ctx, project.id);
    expect(obra.chapters.find((c) => c.code === "01")).toMatchObject({ progressPct: 100, status: "done" });
    expect(obra.hitos.find((h) => h.code === "H2")!.readyPct).toBe(50);
  });
});

describe("invoice requests", () => {
  async function finish(ctx: Ctx, projectId: string, code: string) {
    await svc.startChapter(ctx, projectId, code, { date: "2026-07-01" });
    return svc.finishChapter(ctx, projectId, code, { date: "2026-08-01" });
  }

  it("asks Administration to invoice a hito once its last chapter finishes", async () => {
    const { ctx, project } = await setup();

    expect((await finish(ctx, project.id, "01")).invoiceRequested).toBeNull();
    expect((await milestone(ctx, project.id, "H2")).state).toBe("pending");
    expect((await finish(ctx, project.id, "02")).invoiceRequested).toBe("H2");

    const h2 = await milestone(ctx, project.id, "H2");
    expect(h2.state).toBe("requested");
    expect(h2.request).toMatchObject({
      hitoCode: "H2",
      chapterCode: "02",
      amountCents: 37_800,
      description: "H2 Movimiento de tierras y cimentación (01, 02)",
      clientName: "Marta Ruiz",
      requestedBy: "Rubén García",
    });
    // The Payments tab sees it too.
    const hitos = await hitosService.listHitos(ctx, project.id);
    expect(hitos.find((h) => h.code === "H2")!.invoiceRequestedAt).toBe(h2.request!.requestedAt);
  });

  it("never makes a second request for the same hito, whatever is corrected", async () => {
    const { ctx, project } = await setup();
    await finish(ctx, project.id, "01");
    await finish(ctx, project.id, "02");

    // Reopened, then finished again by a correction and by a finish.
    await svc.correctChapter(ctx, project.id, "02", { actualEnd: null });
    expect(await svc.correctChapter(ctx, project.id, "02", { actualEnd: "2026-08-02" })).toMatchObject({
      state: "finished",
      invoiceRequested: null,
    });
    await svc.correctChapter(ctx, project.id, "02", { actualEnd: null });
    expect((await svc.finishChapter(ctx, project.id, "02", { date: "2026-08-03" })).invoiceRequested).toBeNull();

    const requests = await db.select().from(obraInvoiceRequests).where(eq(obraInvoiceRequests.projectId, project.id));
    expect(requests).toHaveLength(1);
  });

  it("makes one request when a hito's last two chapters finish at the same time", async () => {
    const { ctx, project } = await setup();
    for (const code of ["01", "02"]) await svc.startChapter(ctx, project.id, code, { date: "2026-07-01" });

    const results = await Promise.all(
      ["01", "02"].map((code) => svc.finishChapter(ctx, project.id, code, { date: "2026-08-01" })),
    );
    expect(results.map((r) => r.invoiceRequested).filter(Boolean)).toEqual(["H2"]);
    const requests = await db.select().from(obraInvoiceRequests).where(eq(obraInvoiceRequests.projectId, project.id));
    expect(requests).toHaveLength(1);
  });

  it("follows Sales after the request: invoiced, then collected only once paid", async () => {
    const { ctx, admin, project } = await setup();
    await finish(ctx, project.id, "03");
    const h3 = (await hitosService.listHitos(admin, project.id)).find((h) => h.code === "H3")!;

    await hitosService.uploadHitoFile(admin, project.id, h3.id, "invoice", {
      file: new File(["%PDF-1.7 factura"], "f.pdf", { type: "application/pdf" }),
      date: "2026-10-10",
    });
    expect(await milestone(ctx, project.id, "H3")).toMatchObject({ state: "invoiced", invoicedCents: 47_250, collectedCents: 0, outstandingCents: 47_250, hasInvoice: true });

    await hitosService.registerPayment(admin, project.id, h3.id, { paidOn: "2026-10-15" });
    expect(await milestone(ctx, project.id, "H3")).toMatchObject({ state: "collected", outstandingCents: 0 });
  });
});

describe("correctChapter", () => {
  it("corrects dates with a note, keeping each previous value", async () => {
    const { ctx, project } = await setup();
    await svc.startChapter(ctx, project.id, "01", { date: "2026-09-22" });

    expect(await svc.correctChapter(ctx, project.id, "01", { actualStart: "2026-09-21", note: "Empezó el lunes" })).toEqual({
      state: "in_progress",
      invoiceRequested: null,
    });
    const [correction] = (await svc.getControlChapter(ctx, project.id, "01")).events;
    expect(correction).toMatchObject({
      kind: "correct_start",
      previousDate: "2026-09-22",
      newDate: "2026-09-21",
      note: "Empezó el lunes",
    });

    // Clearing the start makes it pending again.
    expect((await svc.correctChapter(ctx, project.id, "01", { actualStart: null })).state).toBe("pending");
  });

  it("refuses an end before the start, an end without a start, and an unrecorded chapter", async () => {
    const { ctx, project } = await setup();
    await expect(svc.correctChapter(ctx, project.id, "01", { actualStart: "2026-09-01" })).rejects.toMatchObject({ code: "invalid_state" });

    await svc.startChapter(ctx, project.id, "01", { date: "2026-09-10" });
    await expect(svc.correctChapter(ctx, project.id, "01", { actualEnd: "2026-09-09" })).rejects.toMatchObject({ code: "invalid_date" });
    await expect(svc.correctChapter(ctx, project.id, "01", { actualStart: null, actualEnd: "2026-09-12" })).rejects.toMatchObject({ code: "invalid_date" });
  });

  it("logs nothing when nothing changes", async () => {
    const { ctx, project } = await setup();
    await svc.startChapter(ctx, project.id, "01", { date: "2026-09-10" });
    await svc.correctChapter(ctx, project.id, "01", { actualStart: "2026-09-10" });

    const events = await db.select().from(obraProgressEvents).where(eq(obraProgressEvents.projectId, project.id));
    expect(events).toHaveLength(1);
  });
});

describe("budget revisions", () => {
  it("flags chapters a new contract adds or removes, keeps their records, until reviewed", async () => {
    const { ctx, admin, project } = await setup();
    await svc.startChapter(ctx, project.id, "03", { date: "2026-10-01" });

    // Rev.1: chapter 03 out, chapter 04 in.
    const { revisionId } = await budgetService.createRevision(admin, project.id);
    const { revision } = await budgetService.getBudget(admin, project.id, revisionId);
    const ch = (code: string) => revision!.chapters.find((c) => c.code === code)!;
    await budgetService.deleteLine(admin, project.id, ch("03").lines[0]!.id);
    await budgetService.addLine(admin, project.id, ch("04").id, { code: "04.01", description: "Tabiquería", unit: "m²", quantity: 1, unitPriceCents: 100_000 });
    await budgetService.acceptRevision(admin, project.id, revisionId);

    const control = await svc.getControl(ctx, project.id);
    expect(control.chapters.map((c) => [c.code, c.added])).toEqual([
      ["01", false],
      ["02", false],
      ["04", true],
    ]);
    expect(control.removedChapters).toEqual([{ code: "03", name: expect.any(String), actualStart: "2026-10-01", actualEnd: null }]);
    expect(control.reviewPending).toBe(true);

    await svc.reviewChanges(ctx, project.id);
    const reviewed = await svc.getControl(ctx, project.id);
    expect(reviewed.reviewPending).toBe(false);
    expect(reviewed.chapters.every((c) => !c.added)).toBe(true);
    // What was recorded on 03 stays.
    expect(reviewed.removedChapters.map((c) => c.code)).toEqual(["03"]);
  });
});

describe("getCosts", () => {
  it("compares each line's cost with what Compras contracted, leaving uncontracted lines empty", async () => {
    const { ctx, admin, project } = await setup();
    const { id: subcontractorId } = await subcontractorsService.createSubcontractor(admin, {
      kind: "company",
      legalName: "Montajes Steel Norte S.L.",
      taxId: "B39123450",
      address: "Polígono Raos 4",
      postalCode: "39600",
      city: "Maliaño",
    });
    const form = await purchasingService.getPurchaseForm(ctx, project.id);
    await purchasingService.createPurchase(ctx, project.id, {
      kind: "subcontract",
      subcontractorId,
      description: "Actuaciones previas",
      status: "contracted",
      lines: [{ lineageId: form.chapters[0]!.lines[0]!.lineageId, amountCents: 104_000 }],
    });

    const { chapters, sources } = await svc.getCosts(ctx, project.id);
    expect(sources.purchasing).toBe("live");
    expect(chapters[0]!.lines[0]).toMatchObject({ contractedCents: 104_000, contracting: "closed", deviationCents: -4_000, deviationBp: -400 });
    expect(chapters[1]!.lines[0]).toMatchObject({ costCents: 100_000, contractedCents: null, contracting: "none", deviationCents: null, deviationBp: null });

    // The summary's deviation is over the contracted lines only.
    const { cost } = await svc.getControl(ctx, project.id);
    expect(cost).toMatchObject({ contractedCents: 104_000, contractedCostCents: 100_000, deviationCents: -4_000, deviationBp: -400 });
  });
});

describe("issues and changes", () => {
  const issue = (overrides: Record<string, unknown> = {}) => ({
    kind: "issue",
    occurredOn: "2026-10-08",
    chapterCode: "02",
    description: "Retraso en el suministro del panel",
    party: "subcontractor",
    partyName: "Montajes Norte",
    ...overrides,
  });

  it("logs issues and changes, numbered per kind, with optional impacts", async () => {
    const { ctx, project } = await setup();

    expect(await svc.createIssue(ctx, project.id, issue())).toMatchObject({ number: 1 });
    expect(await svc.createIssue(ctx, project.id, issue({ scheduleImpactDays: 3 }))).toMatchObject({ number: 2 });
    expect(await svc.createIssue(ctx, project.id, issue({ kind: "change", party: "client", costImpactCents: 235_000 }))).toMatchObject({ number: 1 });

    const all = await svc.listIssues(ctx, project.id);
    expect(all).toHaveLength(3);
    expect(all.find((i) => i.kind === "issue" && i.number === 1)).toMatchObject({
      status: "pending",
      costImpactCents: null,
      scheduleImpactDays: null,
      partyName: "Montajes Norte",
      createdBy: "Rubén García",
    });
    expect(await svc.listIssues(ctx, project.id, { kind: "change" })).toHaveLength(1);
  });

  it("numbers records made at the same time one after another", async () => {
    const { ctx, project } = await setup();
    const made = await Promise.all([1, 2, 3].map(() => svc.createIssue(ctx, project.id, issue())));
    expect(made.map((m) => m.number).sort()).toEqual([1, 2, 3]);
  });

  it("checks what it is given", async () => {
    const { ctx, project } = await setup();
    await expect(svc.createIssue(ctx, project.id, issue({ description: "" }))).rejects.toMatchObject({ code: "missing_fields" });
    await expect(svc.createIssue(ctx, project.id, issue({ chapterCode: "20" }))).rejects.toMatchObject({ code: "unknown_chapter" });
    await expect(svc.createIssue(ctx, project.id, issue({ party: "neighbour" }))).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.createIssue(ctx, project.id, issue({ occurredOn: "2026-10-30" }))).rejects.toMatchObject({ code: "invalid_date" });
    await expect(svc.createIssue(ctx, project.id, issue({ scheduleImpactDays: 1.5 }))).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.createIssue(ctx, project.id, issue({ costImpactCents: 3_000_000_000 }))).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.listIssues(ctx, project.id, { kind: "changes" })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("updates a record and its status; resolved ones stay in the history", async () => {
    const { ctx, project } = await setup();
    const { issueId } = await svc.createIssue(ctx, project.id, issue());
    expect((await chapter(ctx, project.id, "02")).openIssues).toBe(1);

    await svc.updateIssue(ctx, project.id, issueId, { status: "resolved", costImpactCents: 32_000 });

    const control = await svc.getControl(ctx, project.id);
    expect(control.issues).toEqual([]);
    expect(control.chapters.find((c) => c.code === "02")!.openIssues).toBe(0);
    const { issues } = await svc.getControlChapter(ctx, project.id, "02");
    expect(issues[0]).toMatchObject({ status: "resolved", costImpactCents: 32_000 });
  });

  it("never changes the chapter's dates or asks for an invoice", async () => {
    const { ctx, project } = await setup();
    await svc.createIssue(ctx, project.id, issue({ scheduleImpactDays: 10 }));
    const control = await svc.getControl(ctx, project.id);
    expect(control.chapters.find((c) => c.code === "02")!.state).toBe("pending");
    expect(control.milestones.every((m) => m.request === null)).toBe(true);
  });

  it("keeps supporting files: adds, opens and removes them", async () => {
    const { ctx, project } = await setup();
    const { issueId } = await svc.createIssue(ctx, project.id, issue());

    const pdf = new File(["%PDF-1.7 albarán"], "Albarán.pdf", { type: "application/pdf" });
    const { fileId } = await svc.addIssueFile(ctx, project.id, issueId, { file: pdf });
    const email = new File(["From: obra@example.com"], "aviso.eml");
    await svc.addIssueFile(ctx, project.id, issueId, { file: email });

    const [record] = await svc.listIssues(ctx, project.id);
    expect(record!.files.map((f) => [f.filename, f.contentType])).toEqual([
      ["Albarán.pdf", "application/pdf"],
      ["aviso.eml", "message/rfc822"],
    ]);
    const opened = await svc.openIssueFile(ctx, project.id, issueId, fileId);
    expect(opened).toMatchObject({ filename: "Albarán.pdf", contentType: "application/pdf" });

    await expect(
      svc.addIssueFile(ctx, project.id, issueId, { file: new File(["MZ"], "virus.exe") }),
    ).rejects.toMatchObject({ code: "invalid_file_type" });
    await expect(
      svc.addIssueFile(ctx, project.id, issueId, { file: new File(["no pdf"], "fake.pdf") }),
    ).rejects.toMatchObject({ code: "invalid_file_type" });

    await svc.deleteIssueFile(ctx, project.id, issueId, fileId);
    expect((await svc.listIssues(ctx, project.id))[0]!.files).toHaveLength(1);
    expect(files.size).toBe(1);
  });

  it("keeps tenants' records apart and viewers read-only", async () => {
    const { tenant, ctx, project } = await setup();
    const { issueId } = await svc.createIssue(ctx, project.id, issue());
    const viewer: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "viewer" })).id, role: "viewer" };
    await expect(svc.updateIssue(viewer, project.id, issueId, { status: "resolved" })).rejects.toMatchObject({ code: "forbidden" });
    expect(await svc.listIssues(viewer, project.id)).toHaveLength(1);

    const other = await createTestTenant();
    const stranger: Ctx = { tenantId: other.id, userId: (await createTestUser(other.id)).id, role: "admin" };
    const theirs = await createTestProject(other.id);
    await expect(svc.updateIssue(stranger, theirs.id, issueId, { status: "resolved" })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.openIssueFile(stranger, theirs.id, issueId, "x")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("seedControl", () => {
  it("records the demo obra's dates and issues", async () => {
    const { seedObra, seedControl } = await import("../src/seed/seed-obra");
    const tenant = await createTestTenant();
    const admin: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" };
    const project = await createTestProject(tenant.id, {
      startDate: new Date("2026-03-10T00:00:00Z"),
      completionDate: new Date("2027-01-15T00:00:00Z"),
    });
    await seedObra(admin, project.id);
    await seedControl(admin, project.id);

    const control = await svc.getControl(admin, project.id);
    const state = (code: string) => control.chapters.find((c) => c.code === code)!.state;
    expect([state("01"), state("03"), state("06"), state("12")]).toEqual(["finished", "finished", "in_progress", "pending"]);
    expect(control.issues).toHaveLength(3);
    // H2 and H3 were invoiced already; their requests are on record.
    expect(control.milestones.find((m) => m.code === "H3")).toMatchObject({ state: "invoiced", request: { chapterCode: "03" } });
  });
});

describe("document warnings", () => {
  it("come only from the companies working on this obra", async () => {
    const { seedSubcontractors } = await import("../src/seed/subcontractors");
    const { ctx, admin, project } = await setup();
    const elsewhere = await createTestProject(ctx.tenantId);
    await seedSubcontractors(admin, elsewhere.id, { files: false });

    expect((await svc.getControl(ctx, project.id)).documentAlerts).toEqual([]);
    const theirs = await svc.getControl(ctx, elsewhere.id);
    expect(theirs.documentAlerts.length).toBeGreaterThan(0);
    expect(theirs.documentAlerts.every((a) => a.projectId === null || a.projectId === elsewhere.id)).toBe(true);
  });
});
