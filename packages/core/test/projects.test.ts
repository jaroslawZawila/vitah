import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDocument,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import {
  budgetRevisions,
  db,
  eq,
  obraIssues,
  purchaseInvoices,
  purchaseOrders,
  subcontractorAssignments,
  subcontractors,
} from "@repo/db";
import {
  budgetIssueService,
  budgetService,
  constructionService,
  hitosService,
  projectsService as svc,
  purchasingService,
  subcontractorsService,
  type Ctx,
} from "../src";
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

describe("deleteProject", () => {
  it("deletes a project in the tenant", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);

    await expect(svc.deleteProject(ctx, project.id)).resolves.toEqual({
      projectId: project.id,
    });
    expect(await svc.getProject(ctx, project.id)).toBeNull();
  });

  it("does not delete another tenant's project", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);

    await expect(
      svc.deleteProject(await otherTenantCtx(), project.id),
    ).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await svc.getProject(ctx, project.id)).not.toBeNull();
  });

  it("answers not_found for another tenant's project even when it has records", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    await acceptedBudget(ctx, project.id);

    await expect(svc.deleteProject(await otherTenantCtx(), project.id)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    expect(await svc.getProject(ctx, project.id)).not.toBeNull();
  });
});

/** Accepts a budget of chapters 01–03 (1.000 € each): the project's contract. */
async function acceptedBudget(ctx: Ctx, projectId: string) {
  const { revisionId } = await framerDraft(ctx, projectId, ["01", "02", "03"]);
  await budgetService.acceptRevision(ctx, projectId, revisionId, {}, { unissued: true });
}

/** A material supplier and a pending order to it on the project (which needs its accepted budget). */
async function pendingOrders(ctx: Ctx, projectId: string, count = 1) {
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
  const orderIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const { orderId } = await purchasingService.createPurchase(ctx, projectId, {
      kind: "material",
      subcontractorId,
      description: "Mampostería de piedra natural",
      lines: [{ lineageId: form.chapters[0]!.lines[0]!.lineageId, amountCents: 40_000 }],
    });
    orderIds.push(orderId);
  }
  return { subcontractorId, orderIds };
}

describe("deleteProject with records to keep", () => {
  const blocked = { code: "project_has_records", status: 409 };

  async function expectKept(ctx: Ctx, projectId: string) {
    await expect(svc.deleteProject(ctx, projectId)).rejects.toMatchObject(blocked);
    expect(await svc.getProject(ctx, projectId)).not.toBeNull();
  }

  it("deletes a project whose budget is still a draft", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    await framerDraft(ctx, project.id, ["01"]);

    await expect(svc.deleteProject(ctx, project.id)).resolves.toEqual({ projectId: project.id });
    expect(await svc.getProject(ctx, project.id)).toBeNull();
  });

  it("keeps a project with an issued budget, the budget included", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    const { revisionId } = await framerDraft(ctx, project.id, ["01"]);
    await budgetIssueService.issueRevision(ctx, project.id, revisionId);

    await expectKept(ctx, project.id);
    expect((await budgetService.getBudget(ctx, project.id)).revision).toMatchObject({ status: "issued" });
  });

  it("keeps a project with an accepted budget", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    await acceptedBudget(ctx, project.id);

    await expectKept(ctx, project.id);
  });

  // Each of the rest is checked on its own: the budget is put back to draft
  // behind the service's back, so only the record under test blocks.
  async function contractThenDraft(ctx: Ctx, projectId: string, record: () => Promise<unknown>) {
    await acceptedBudget(ctx, projectId);
    await record();
    await db.update(budgetRevisions).set({ status: "draft" }).where(eq(budgetRevisions.projectId, projectId));
  }

  it("deletes a project whose only orders are pending or cancelled", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    await contractThenDraft(ctx, project.id, async () => {
      const { orderIds } = await pendingOrders(ctx, project.id, 2);
      await purchasingService.setPurchaseStatus(ctx, orderIds[1]!, { status: "cancelled", note: "Duplicado" });
    });

    await expect(svc.deleteProject(ctx, project.id)).resolves.toEqual({ projectId: project.id });
    expect(await svc.getProject(ctx, project.id)).toBeNull();
  });

  it("keeps a project with a placed order", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    await contractThenDraft(ctx, project.id, async () => {
      const { orderIds } = await pendingOrders(ctx, project.id);
      await purchasingService.setPurchaseStatus(ctx, orderIds[0]!, { status: "ordered" });
    });

    await expectKept(ctx, project.id);
    expect(await db.select().from(purchaseOrders).where(eq(purchaseOrders.projectId, project.id))).toHaveLength(1);
  });

  it("waits for an order being placed meanwhile, and then keeps the project", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    let orderId = "";
    await contractThenDraft(ctx, project.id, async () => {
      orderId = (await pendingOrders(ctx, project.id)).orderIds[0]!;
    });

    // The order is placed in a transaction still open when the delete starts.
    let commit = () => {};
    const placed = new Promise<void>((resolve) => {
      void db.transaction(async (tx) => {
        await tx.update(purchaseOrders).set({ status: "ordered" }).where(eq(purchaseOrders.id, orderId));
        await new Promise<void>((release) => {
          commit = release;
          resolve();
        });
      });
    });
    await placed;
    const deleting = svc.deleteProject(ctx, project.id);
    deleting.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 150));
    commit();

    await expect(deleting).rejects.toMatchObject(blocked);
    expect(await svc.getProject(ctx, project.id)).not.toBeNull();
  });

  it("keeps a project with a supplier's invoice, whatever its order's status", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    await contractThenDraft(ctx, project.id, async () => {
      const { subcontractorId, orderIds } = await pendingOrders(ctx, project.id);
      await db.insert(purchaseInvoices).values({
        tenantId: ctx.tenantId,
        orderId: orderIds[0]!,
        subcontractorId,
        number: "F-2026/118",
        issuedOn: "2026-10-01",
        baseCents: 40_000,
        vatKind: "vat21",
        vatCents: 8_400,
      });
    });

    await expectKept(ctx, project.id);
  });

  it("keeps a project with a hito's registered payment", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    await contractThenDraft(ctx, project.id, async () => {
      const [h0] = await hitosService.listHitos(ctx, project.id);
      await hitosService.registerPayment(ctx, project.id, h0!.id, { paidOn: "2026-02-03" });
    });

    await expectKept(ctx, project.id);
  });

  it("keeps a project whose hito payment was registered and then cancelled: its history stays", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    await contractThenDraft(ctx, project.id, async () => {
      const [h0] = await hitosService.listHitos(ctx, project.id);
      await hitosService.registerPayment(ctx, project.id, h0!.id, { paidOn: "2026-02-03" });
      await hitosService.cancelPayment(ctx, project.id, h0!.id);
    });

    await expectKept(ctx, project.id);
  });

  it.each(["acta", "invoice"] as const)("keeps a project with a hito's %s", async (kind) => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    await contractThenDraft(ctx, project.id, async () => {
      const [h0] = await hitosService.listHitos(ctx, project.id);
      const file = new File(["%PDF-1.7 hito"], "hito.pdf", { type: "application/pdf" });
      await hitosService.uploadHitoFile(ctx, project.id, h0!.id, kind, { file, date: "2026-02-03" });
    });

    await expectKept(ctx, project.id);
  });

  it("keeps a project with a contract among its documents, but not for its other documents", async () => {
    const { tenant, ctx } = await setup();
    const withPlans = await createTestProject(tenant.id);
    await createTestDocument(tenant.id, withPlans.id, { category: "plans" });
    await svc.deleteProject(ctx, withPlans.id);

    const project = await createTestProject(tenant.id);
    await createTestDocument(tenant.id, project.id, { category: "contract" });
    await expectKept(ctx, project.id);
  });

  it("keeps a project with an incident or change logged", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    await db.insert(obraIssues).values({
      tenantId: tenant.id,
      projectId: project.id,
      kind: "change",
      number: 1,
      occurredOn: "2026-10-01",
      chapterCode: "02",
      description: "El cliente pide otra puerta",
      party: "client",
    });
    await expectKept(ctx, project.id);
  });

  it("keeps a project with a subcontractor assigned to it", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    const [company] = await db
      .insert(subcontractors)
      .values({
        tenantId: tenant.id,
        kind: "company",
        legalName: "Montajes Norte S.L.",
        taxId: "B39654322",
        address: "Calle Alta 1",
        postalCode: "39001",
        city: "Santander",
        province: "Cantabria",
        reaRegion: "cb",
      })
      .returning({ id: subcontractors.id });
    await db.insert(subcontractorAssignments).values({ tenantId: tenant.id, subcontractorId: company!.id, projectId: project.id });
    await expectKept(ctx, project.id);
  });

  it("keeps a project whose works have started", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    await contractThenDraft(ctx, project.id, () =>
      constructionService.startChapter(ctx, project.id, "01", { date: "2026-02-03" }),
    );

    await expectKept(ctx, project.id);
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
