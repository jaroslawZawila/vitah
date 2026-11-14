import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestPhoto,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import {
  budgetRevisions,
  db,
  eq,
  obraChapterProgress,
  obraHitoEvents,
  obraHitos,
  projectDocuments,
  projectPhotos,
  projects,
  purchaseOrders,
} from "@repo/db";
import {
  budgetIssueService,
  budgetService,
  constructionService,
  documentsService,
  hitosService,
  obraService,
  photosService,
  planningService,
  projectClientService,
  projectsService as svc,
  purchasingService,
  subcontractorsService,
  type Ctx,
} from "../src";
import { files } from "../src/testing";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));

async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  return { tenant, ctx };
}

/** A caller in a different tenant. */
async function otherTenantCtx(): Promise<Ctx> {
  return (await setup()).ctx;
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("createProject with a client", () => {
  const base = { ref: "VTH-26-020", address: "Calle Mayor 1, Santander" };

  it("attaches a free client in the same step", async () => {
    const { tenant, ctx } = await setup();
    const client = await createTestUser(tenant.id, { role: "client" });

    const { id } = await svc.createProject(ctx, {
      ...base,
      clientId: client.id,
    });

    expect((await svc.getProject(ctx, id))?.client?.id).toBe(client.id);
  });

  it("treats an empty clientId as no client", async () => {
    const { ctx } = await setup();

    const { id } = await svc.createProject(ctx, { ...base, clientId: "" });

    expect((await svc.getProject(ctx, id))?.clientUserId).toBeNull();
  });

  it("is admin only when a client is given", async () => {
    const { tenant, ctx } = await setup();
    const client = await createTestUser(tenant.id, { role: "client" });

    await expect(
      svc.createProject(
        { ...ctx, role: "manager" },
        { ...base, clientId: client.id },
      ),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(await svc.listProjects(ctx)).toEqual([]);
  });

  it.each([
    [
      "another tenant's client",
      async () =>
        (
          await createTestUser((await createTestTenant()).id, {
            role: "client",
          })
        ).id,
    ],
    [
      "a staff user",
      async (tenantId: string) => (await createTestUser(tenantId)).id,
    ],
    [
      "an inactive client",
      async (tenantId: string) =>
        (await createTestUser(tenantId, { role: "client", active: false })).id,
    ],
  ])(
    "rejects %s without creating the project",
    async (_label, makeClientId) => {
      const { tenant, ctx } = await setup();
      const clientId = await makeClientId(tenant.id);

      await expect(
        svc.createProject(ctx, { ...base, clientId }),
      ).rejects.toMatchObject({
        code: "client_not_found",
        status: 404,
      });
      expect(await svc.listProjects(ctx)).toEqual([]);
    },
  );

  it("takes a client who already has another project", async () => {
    const { tenant, ctx } = await setup();
    const client = await createTestUser(tenant.id, { role: "client" });
    await svc.createProject(ctx, { ...base, clientId: client.id });

    await svc.createProject(ctx, { ...base, ref: "VTH-26-021", clientId: client.id });

    expect(await svc.listProjects(ctx)).toHaveLength(2);
  });
});

describe("createProject", () => {
  it("creates a project with ref, address and dates", async () => {
    const { ctx } = await setup();

    const { id } = await svc.createProject(ctx, {
      ref: " VTH-26-010 ",
      address: " Calle del Sol 5, Santander ",
      startDate: "2026-03-01",
      completionDate: "2026-11-15",
    });

    expect(await svc.getProject(ctx, id)).toMatchObject({
      id,
      tenantId: ctx.tenantId,
      ref: "VTH-26-010",
      address: "Calle del Sol 5, Santander",
      startDate: new Date("2026-03-01"),
      completionDate: new Date("2026-11-15"),
      clientUserId: null,
      client: null,
    });
  });

  it("leaves dates empty when they are not given", async () => {
    const { ctx } = await setup();

    const { id } = await svc.createProject(ctx, {
      ref: "VTH-1",
      address: "Calle 1",
      startDate: "",
    });

    expect(await svc.getProject(ctx, id)).toMatchObject({
      startDate: null,
      completionDate: null,
    });
  });

  it.each([
    [{ address: "Calle 1" }],
    [{ ref: "VTH-1" }],
    [{ ref: "  ", address: "Calle 1" }],
    [{ ref: 1, address: 2 }],
  ])("rejects missing fields %j", async (input) => {
    const { ctx } = await setup();

    await expect(svc.createProject(ctx, input)).rejects.toMatchObject({
      code: "missing_fields",
      status: 400,
    });
  });

  it("rejects an invalid date", async () => {
    const { ctx } = await setup();

    await expect(
      svc.createProject(ctx, {
        ref: "VTH-1",
        address: "Calle 1",
        startDate: "not-a-date",
      }),
    ).rejects.toMatchObject({ code: "invalid_date", status: 400 });
  });

  it("rejects a duplicate ref within the tenant, but allows it in another tenant", async () => {
    const { ctx } = await setup();
    await svc.createProject(ctx, { ref: "VTH-1", address: "Calle 1" });

    await expect(
      svc.createProject(ctx, { ref: "VTH-1", address: "Calle 2" }),
    ).rejects.toMatchObject({ code: "ref_exists", status: 400 });
    await expect(
      svc.createProject(await otherTenantCtx(), {
        ref: "VTH-1",
        address: "Calle 2",
      }),
    ).resolves.toHaveProperty("id");
  });
});

describe("listProjects / getProject", () => {
  it("returns only the caller's tenant projects, newest first, with their client", async () => {
    const { tenant, ctx } = await setup();
    const client = await createTestUser(tenant.id, {
      role: "client",
      name: "Ana",
    });
    const older = await createTestProject(tenant.id, {
      createdAt: new Date("2026-01-01"),
    });
    const newer = await createTestProject(tenant.id, {
      createdAt: new Date("2026-02-01"),
      clientUserId: client.id,
    });
    const foreign = await createTestProject((await createTestTenant()).id);

    const list = await svc.listProjects(ctx);
    expect(list.map((p) => p.id)).toEqual([newer.id, older.id]);
    expect(list[0]!.client).toEqual({
      id: client.id,
      name: "Ana",
      email: client.email,
    });
    expect(list[1]!.client).toBeNull();

    expect(await svc.getProject(ctx, foreign.id)).toBeNull();
    expect(await svc.getProject(ctx, "missing")).toBeNull();
  });
});

describe("updateProject", () => {
  it("updates address and dates, ignoring unknown keys", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id, { ref: "VTH-1" });

    await expect(
      svc.updateProject(ctx, project.id, {
        address: "Calle Nueva 2",
        startDate: "2026-04-01",
        completionDate: "2026-12-01",
        ref: "VTH-CHANGED",
        tenantId: "hijack",
      }),
    ).resolves.toEqual({ projectId: project.id });

    expect(await svc.getProject(ctx, project.id)).toMatchObject({
      ref: "VTH-1",
      tenantId: tenant.id,
      address: "Calle Nueva 2",
      startDate: new Date("2026-04-01"),
      completionDate: new Date("2026-12-01"),
    });
  });

  it("keeps fields that are not provided and clears empty dates", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id, {
      address: "Calle 1",
      startDate: new Date("2026-03-01"),
      completionDate: new Date("2026-11-15"),
    });

    await svc.updateProject(ctx, project.id, { completionDate: "" });

    expect(await svc.getProject(ctx, project.id)).toMatchObject({
      address: "Calle 1",
      startDate: new Date("2026-03-01"),
      completionDate: null,
    });
  });

  it("rejects an empty address", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);

    await expect(
      svc.updateProject(ctx, project.id, { address: " " }),
    ).rejects.toMatchObject({
      code: "missing_fields",
    });
  });

  it("does not update another tenant's project", async () => {
    const { tenant } = await setup();
    const project = await createTestProject(tenant.id, { address: "Calle 1" });

    await expect(
      svc.updateProject(await otherTenantCtx(), project.id, {
        address: "Hacked",
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(
      (
        await svc.listProjects({
          tenantId: tenant.id,
          userId: "x",
          role: "admin",
        })
      )[0],
    ).toMatchObject({
      address: "Calle 1",
    });
  });
});

/** Accepts a budget of chapters 01–03 (1.000 € each): the project's contract. */
async function acceptedBudget(ctx: Ctx, projectId: string) {
  const { revisionId } = await framerDraft(ctx, projectId, ["01", "02", "03"]);
  await budgetService.acceptRevision(ctx, projectId, revisionId, {}, { unissued: true });
}

/** A material supplier and an order placed with it on the project (which needs its accepted budget). */
async function placedOrder(ctx: Ctx, projectId: string) {
  const { id: subcontractorId } = await subcontractorsService.createSubcontractor(ctx, {
    kind: "company",
    legalName: "Piedra de Liébana S.L.",
    taxId: "B39654322",
    address: "Polígono Raos 4",
    postalCode: "39600",
    city: "Maliaño",
    suppliesOnly: true,
  });
  const form = await purchasingService.getPurchaseForm(ctx, projectId);
  const { orderId } = await purchasingService.createPurchase(ctx, projectId, {
    kind: "material",
    subcontractorId,
    description: "Mampostería de piedra natural",
    lines: [{ lineageId: form.chapters[0]!.lines[0]!.lineageId, amountCents: 40_000 }],
  });
  await purchasingService.setPurchaseStatus(ctx, orderId, { status: "ordered" });
  return { subcontractorId, orderId };
}

/** The project's row as the database has it, deleted or not. */
async function stored(projectId: string) {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
  return row;
}

const pdf = () => new File(["%PDF-1.7 contrato"], "contrato.pdf", { type: "application/pdf" });

describe("deleteProject", () => {
  it("archives the project: who deleted it and when, its row kept", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    const before = Date.now();

    await expect(svc.deleteProject(ctx, project.id)).resolves.toEqual({ projectId: project.id });

    const row = await stored(project.id);
    expect(row).toMatchObject({ id: project.id, ref: project.ref, address: project.address, deletedById: ctx.userId });
    expect(row!.deletedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row!.deletedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("erases nothing: its documents, photos, budget, hitos and stored files stay", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    const { documentId } = await documentsService.addDocument(ctx, project.id, { file: pdf(), title: "Contrato", category: "contract" });
    const photo = await createTestPhoto(tenant.id, project.id);
    files.set(photo.pathname, new Blob(["jpeg"]));
    await framerDraft(ctx, project.id, ["01"]);
    const kept = [...files.keys()].sort();
    expect(kept).toHaveLength(2);

    await svc.deleteProject(ctx, project.id);

    expect([...files.keys()].sort()).toEqual(kept);
    expect(await db.select({ id: projectDocuments.id }).from(projectDocuments).where(eq(projectDocuments.projectId, project.id))).toEqual([
      { id: documentId },
    ]);
    expect(await db.select({ id: projectPhotos.id }).from(projectPhotos).where(eq(projectPhotos.projectId, project.id))).toEqual([
      { id: photo.id },
    ]);
    expect(await db.select().from(budgetRevisions).where(eq(budgetRevisions.projectId, project.id))).toHaveLength(1);
    expect((await db.select().from(obraHitos).where(eq(obraHitos.projectId, project.id))).length).toBeGreaterThan(0);
  });

  it("archives a project with an accepted budget, a placed order and a paid hito, all of them kept", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    await acceptedBudget(ctx, project.id);
    const { orderId } = await placedOrder(ctx, project.id);
    const [h0] = await hitosService.listHitos(ctx, project.id);
    await hitosService.registerPayment(ctx, project.id, h0!.id, { paidOn: "2026-02-03" });
    await constructionService.startChapter(ctx, project.id, "01", { date: "2026-02-03" });

    await expect(svc.deleteProject(ctx, project.id)).resolves.toEqual({ projectId: project.id });

    expect(await svc.getProject(ctx, project.id)).toBeNull();
    expect(await db.select({ status: budgetRevisions.status }).from(budgetRevisions).where(eq(budgetRevisions.projectId, project.id))).toEqual([
      { status: "accepted" },
    ]);
    expect(
      await db.select({ id: purchaseOrders.id, status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.projectId, project.id)),
    ).toEqual([{ id: orderId, status: "ordered" }]);
    expect(await db.select({ paidOn: obraHitos.paidOn }).from(obraHitos).where(eq(obraHitos.id, h0!.id))).toEqual([{ paidOn: "2026-02-03" }]);
    expect(await db.select().from(obraHitoEvents).where(eq(obraHitoEvents.hitoId, h0!.id))).toHaveLength(1);
    expect(await db.select().from(obraChapterProgress).where(eq(obraChapterProgress.projectId, project.id))).toHaveLength(1);
  });

  it("takes it off the list and the detail, the tenant's other projects untouched", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    const other = await createTestProject(tenant.id);

    await svc.deleteProject(ctx, project.id);

    expect(await svc.getProject(ctx, project.id)).toBeNull();
    expect((await svc.listProjects(ctx)).map((p) => p.id)).toEqual([other.id]);
    expect(await svc.getProject(ctx, other.id)).toMatchObject({ id: other.id });
    expect((await stored(other.id))!.deletedAt).toBeNull();
  });

  it("can't be read or written any more, through any module", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    const client = await createTestUser(tenant.id, { role: "client" });
    await acceptedBudget(ctx, project.id);
    const [h0] = await hitosService.listHitos(ctx, project.id);
    const { documentId } = await documentsService.addDocument(ctx, project.id, { file: pdf(), title: "Planos", category: "plans" });
    const { revisionId } = await budgetService.createRevision(ctx, project.id);
    await budgetService.updateRevision(ctx, project.id, revisionId, { changeReason: "Cambio de carpintería" });
    await budgetIssueService.issueRevision(ctx, project.id, revisionId);
    const kept = files.size;
    const before = await stored(project.id);

    await svc.deleteProject(ctx, project.id);

    const gone = { code: "project_not_found", status: 404 };
    await expect(svc.updateProject(ctx, project.id, { address: "Otra" })).rejects.toMatchObject({ code: "not_found", status: 404 });
    // Reads.
    await expect(budgetService.getBudget(ctx, project.id)).rejects.toMatchObject(gone);
    await expect(obraService.getObra(ctx, project.id)).rejects.toMatchObject(gone);
    await expect(hitosService.listHitos(ctx, project.id)).rejects.toMatchObject(gone);
    await expect(hitosService.getHito(ctx, project.id, h0!.id)).rejects.toMatchObject(gone);
    await expect(planningService.getPlanning(ctx, project.id)).rejects.toMatchObject(gone);
    await expect(constructionService.getControl(ctx, project.id)).rejects.toMatchObject(gone);
    await expect(documentsService.listDocuments(ctx, project.id)).rejects.toMatchObject(gone);
    // The issued PDFs are among its documents: not served either.
    await expect(budgetIssueService.revisionPdf(ctx, project.id, revisionId, "general")).rejects.toMatchObject(gone);
    await expect(photosService.listPhotos(ctx, project.id)).rejects.toMatchObject(gone);
    await expect(purchasingService.getPurchaseForm(ctx, project.id)).rejects.toMatchObject(gone);
    // Writes.
    await expect(
      documentsService.addDocument(ctx, project.id, { file: pdf(), title: "Contrato", category: "contract" }),
    ).rejects.toMatchObject(gone);
    await expect(budgetService.createRevision(ctx, project.id)).rejects.toMatchObject(gone);
    await expect(obraService.setStage(ctx, project.id, { stage: 7 })).rejects.toMatchObject(gone);
    await expect(hitosService.registerPayment(ctx, project.id, h0!.id, { paidOn: "2026-02-03" })).rejects.toMatchObject(gone);
    await expect(constructionService.startChapter(ctx, project.id, "01", { date: "2026-02-03" })).rejects.toMatchObject(gone);
    await expect(planningService.createPlanningDraft(ctx, project.id, { from: "template", startDate: "2026-03-02" })).rejects.toMatchObject(gone);
    await expect(projectClientService.assignProjectClient(ctx, project.id, { clientId: client.id })).rejects.toMatchObject(gone);
    await expect(projectClientService.unassignProjectClient(ctx, project.id)).rejects.toMatchObject({ status: 404 });

    // None of it left a trace on the row.
    expect(await stored(project.id)).toEqual({ ...before, deletedAt: expect.any(Date), deletedById: ctx.userId });
    expect(files.size).toBe(kept);
    expect(await db.select({ id: projectDocuments.id }).from(projectDocuments).where(eq(projectDocuments.id, documentId))).toHaveLength(1);
  });

  it("answers not_found the second time, and keeps who deleted it first", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    const second = await createTestUser(tenant.id, { role: "admin" });

    await svc.deleteProject(ctx, project.id);
    const first = await stored(project.id);

    await expect(svc.deleteProject({ ...ctx, userId: second.id }, project.id)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    expect(await stored(project.id)).toEqual(first);
  });

  it("answers not_found for a project that doesn't exist", async () => {
    const { ctx } = await setup();

    await expect(svc.deleteProject(ctx, "no-such-project")).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("does not delete another tenant's project, with records or without", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    const withBudget = await createTestProject(tenant.id);
    await acceptedBudget(ctx, withBudget.id);
    const outsider = await otherTenantCtx();

    for (const { id } of [project, withBudget]) {
      await expect(svc.deleteProject(outsider, id)).rejects.toMatchObject({ code: "not_found", status: 404 });
      expect(await svc.getProject(ctx, id)).not.toBeNull();
      expect(await stored(id)).toMatchObject({ deletedAt: null, deletedById: null });
    }
  });

  it("frees its ref for a new project, which then holds it alone", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id, { ref: "VTH-26-030" });
    const input = { ref: "VTH-26-030", address: "Calle Nueva 2, Santander" };
    await expect(svc.createProject(ctx, input)).rejects.toMatchObject({ code: "ref_exists" });

    await svc.deleteProject(ctx, project.id);
    const { id } = await svc.createProject(ctx, input);

    expect(id).not.toBe(project.id);
    expect(await svc.listProjects(ctx)).toMatchObject([{ id, ref: "VTH-26-030", address: "Calle Nueva 2, Santander" }]);
    await expect(svc.createProject(ctx, input)).rejects.toMatchObject({ code: "ref_exists" });
    // The deleted one keeps its ref, and the new one can be deleted in its turn.
    await svc.deleteProject(ctx, id);
    expect((await stored(project.id))!.ref).toBe("VTH-26-030");
    expect((await stored(id))!.ref).toBe("VTH-26-030");
    expect(await svc.listProjects(ctx)).toEqual([]);
  });
});

describe("project roles", () => {
  const input = { ref: "VTH-1", address: "Calle 1" };

  it("lets managers create and edit, but not delete", async () => {
    const { ctx } = await setup();
    const manager: Ctx = { ...ctx, role: "manager" };

    const { id } = await svc.createProject(manager, input);
    await expect(svc.updateProject(manager, id, { address: "Calle 2" })).resolves.toEqual({
      projectId: id,
    });
    await expect(svc.deleteProject(manager, id)).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
    expect(await svc.getProject(ctx, id)).not.toBeNull();
  });

  it("lets viewers only read", async () => {
    const { tenant, ctx } = await setup();
    const viewer: Ctx = { ...ctx, role: "viewer" };
    const project = await createTestProject(tenant.id, { address: "Calle 1" });

    await expect(svc.createProject(viewer, input)).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
    await expect(
      svc.updateProject(viewer, project.id, { address: "Hacked" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.deleteProject(viewer, project.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await svc.getProject(viewer, project.id)).toMatchObject({ address: "Calle 1" });
  });
});

describe("project input", () => {
  it.each(["2026-02-31", "1", "+275760-09-13", "2026-01-01T00:00", "2026-02-31T00:00:00Z", "2026-01-01T25:00:00Z", "01/03/2026"])(
    "rejects the non-calendar date %s",
    async (startDate) => {
      const { ctx } = await setup();

      await expect(
        svc.createProject(ctx, { ref: "VTH-1", address: "Calle 1", startDate }),
      ).rejects.toMatchObject({ code: "invalid_date", status: 400 });
    },
  );

  it("takes an ISO timestamp as its UTC date (as /api/v1 accepted before)", async () => {
    const { ctx } = await setup();

    const { id } = await svc.createProject(ctx, {
      ref: "VTH-1",
      address: "Calle 1",
      startDate: "2026-10-01T00:00:00.000Z",
      completionDate: "2026-12-01T23:30:00+02:00",
    });

    expect(await svc.getProject(ctx, id)).toMatchObject({
      startDate: new Date("2026-10-01T00:00:00Z"),
      completionDate: new Date("2026-12-01T00:00:00Z"),
    });
  });

  it("rejects a completion date before the start", async () => {
    const { ctx } = await setup();

    await expect(
      svc.createProject(ctx, {
        ref: "VTH-1",
        address: "Calle 1",
        startDate: "2026-05-01",
        completionDate: "2026-04-30",
      }),
    ).rejects.toMatchObject({ code: "dates_out_of_order", status: 400 });
  });

  it("checks the order against the stored date when only one changes", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id, {
      startDate: new Date("2026-03-01"),
      completionDate: new Date("2026-11-15"),
    });

    await expect(
      svc.updateProject(ctx, project.id, { completionDate: "2026-02-01" }),
    ).rejects.toMatchObject({ code: "dates_out_of_order" });
    await expect(
      svc.updateProject(ctx, project.id, { startDate: "2026-12-01" }),
    ).rejects.toMatchObject({ code: "dates_out_of_order" });
    await expect(
      svc.updateProject(ctx, project.id, { startDate: "2026-12-01", completionDate: "" }),
    ).resolves.toEqual({ projectId: project.id });
  });

  it("rejects an overlong ref or address", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);

    await expect(
      svc.createProject(ctx, { ref: "V".repeat(41), address: "Calle 1" }),
    ).rejects.toMatchObject({ code: "too_long", status: 400 });
    await expect(
      svc.updateProject(ctx, project.id, { address: "a".repeat(301) }),
    ).rejects.toMatchObject({ code: "too_long" });
  });
});
