import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, projectDocuments, projects } from "@repo/db";
import {
  createTestDocument,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import {
  MAX_DOCUMENT_BYTES,
  budgetGenerationsService,
  budgetService,
  documentsService as svc,
  projectsService,
  type Ctx,
} from "../src";
import { files } from "../src/testing";

vi.mock("../src/storage", () => import("../src/testing"));

const pdf = (content = "%PDF-1.7\ncontenido") =>
  new File([content], "contrato.pdf", { type: "application/pdf" });

/** A tenant with an admin caller, a project, and its client. */
async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin", name: "Admin" });
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, { clientUserId: client.id });
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  return { tenant, admin, client, project, ctx };
}

const upload = (ctx: Ctx, projectId: string, input: Record<string, unknown> = {}) =>
  svc.addDocument(ctx, projectId, { title: "Contrato", category: "contract", file: pdf(), ...input });

async function text(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("addDocument", () => {
  it("stores the PDF and records it", async () => {
    const { tenant, project, ctx } = await setup();

    const { documentId } = await upload(ctx, project.id, { title: "  Contrato de obra " });

    const row = await db.query.projectDocuments.findFirst({
      where: eq(projectDocuments.id, documentId),
    });
    expect(row).toMatchObject({
      tenantId: tenant.id,
      projectId: project.id,
      title: "Contrato de obra",
      category: "contract",
      sizeBytes: pdf().size,
      uploadedById: ctx.userId,
    });
    expect(row?.pathname).toBe(`tenants/${tenant.id}/projects/${project.id}/${documentId}.pdf`);
    expect(files.has(row!.pathname)).toBe(true);
  });

  it("cuts an overlong title at 200 characters", async () => {
    const { project, ctx } = await setup();

    const { documentId } = await upload(ctx, project.id, { title: "T".repeat(500) });

    const row = await db.query.projectDocuments.findFirst({
      where: eq(projectDocuments.id, documentId),
    });
    expect(row?.title).toHaveLength(200);
  });

  it("lets managers upload", async () => {
    const { project, ctx } = await setup();

    await expect(upload({ ...ctx, role: "manager" }, project.id)).resolves.toHaveProperty(
      "documentId",
    );
  });

  it("is forbidden for viewers", async () => {
    const { project, ctx } = await setup();

    await expect(upload({ ...ctx, role: "viewer" }, project.id)).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
    expect(files.size).toBe(0);
  });

  it.each([
    ["missing_file", { file: undefined }],
    ["missing_file", { file: new File([], "empty.pdf") }],
    ["missing_file", { file: "not a file" }],
    ["missing_fields", { title: "  " }],
    ["invalid_category", { category: "invoices" }],
    ["invalid_file_type", { file: new File(["hello"], "fake.pdf", { type: "application/pdf" }) }],
  ])("rejects %s", async (code, input) => {
    const { project, ctx } = await setup();

    await expect(upload(ctx, project.id, input)).rejects.toMatchObject({ code, status: 400 });
    expect(files.size).toBe(0);
  });

  it("rejects files over the size limit", async () => {
    const { project, ctx } = await setup();
    const big = new File(["%PDF-", new Uint8Array(MAX_DOCUMENT_BYTES)], "big.pdf");

    await expect(upload(ctx, project.id, { file: big })).rejects.toMatchObject({
      code: "file_too_large",
      status: 413,
    });
  });

  it("does not upload to another tenant's project", async () => {
    const { project } = await setup();
    const other = await setup();

    await expect(upload(other.ctx, project.id)).rejects.toMatchObject({
      code: "project_not_found",
      status: 404,
    });
    expect(files.size).toBe(0);
  });
});

describe("listDocuments", () => {
  it("lists the project's documents, newest first, with the uploader", async () => {
    const { tenant, admin, project, ctx } = await setup();
    const older = await createTestDocument(tenant.id, project.id, {
      title: "Planos",
      category: "plans",
      sizeBytes: 2048,
      createdAt: new Date("2026-01-01T10:00:00Z"),
    });
    const newer = await createTestDocument(tenant.id, project.id, {
      uploadedById: admin.id,
      createdAt: new Date("2026-02-01T10:00:00Z"),
    });
    await createTestDocument(tenant.id, (await createTestProject(tenant.id)).id);

    expect(await svc.listDocuments({ ...ctx, role: "viewer" }, project.id)).toEqual([
      {
        id: newer.id,
        title: "Contrato de obra",
        category: "contract",
        sizeBytes: 1024,
        uploadedAt: "2026-02-01T10:00:00.000Z",
        uploadedBy: "Admin",
        visibleToClient: true,
        contentType: "application/pdf",
        filename: null,
        budgetInput: null,
        budgetPdf: null,
      },
      {
        id: older.id,
        title: "Planos",
        category: "plans",
        sizeBytes: 2048,
        uploadedAt: "2026-01-01T10:00:00.000Z",
        uploadedBy: null,
        visibleToClient: true,
        contentType: "application/pdf",
        filename: null,
        budgetInput: null,
        budgetPdf: null,
      },
    ]);
  });

  it("does not list another tenant's project", async () => {
    const { project } = await setup();
    const other = await setup();

    await expect(svc.listDocuments(other.ctx, project.id)).rejects.toMatchObject({
      code: "project_not_found",
    });
  });
});

describe("deleteDocument", () => {
  it("removes the row and the file", async () => {
    const { project, ctx } = await setup();
    const { documentId } = await upload(ctx, project.id);

    await expect(
      svc.deleteDocument({ ...ctx, role: "manager" }, project.id, documentId),
    ).resolves.toEqual({ documentId });

    expect(await svc.listDocuments(ctx, project.id)).toEqual([]);
    expect(files.size).toBe(0);
  });

  it("is forbidden for viewers", async () => {
    const { project, ctx } = await setup();
    const { documentId } = await upload(ctx, project.id);

    await expect(
      svc.deleteDocument({ ...ctx, role: "viewer" }, project.id, documentId),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(files.size).toBe(1);
  });

  it("does not delete another tenant's document", async () => {
    const { project, ctx } = await setup();
    const { documentId } = await upload(ctx, project.id);
    const other = await setup();

    await expect(svc.deleteDocument(other.ctx, project.id, documentId)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    expect(files.size).toBe(1);
  });
});

describe("openDocument", () => {
  it("streams the file to staff of the tenant", async () => {
    const { project, ctx } = await setup();
    const { documentId } = await upload(ctx, project.id, { title: "Contrato" });

    const file = await svc.openDocument({ ...ctx, role: "viewer" }, project.id, documentId);

    expect(file).toMatchObject({
      filename: "Contrato.pdf",
      contentType: "application/pdf",
      sizeBytes: pdf().size,
    });
    expect(await text(file.body)).toBe("%PDF-1.7\ncontenido");
  });

  it("is not found for another tenant", async () => {
    const { project, ctx } = await setup();
    const { documentId } = await upload(ctx, project.id);
    const other = await setup();

    await expect(svc.openDocument(other.ctx, project.id, documentId)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("is not found when the stored file is missing", async () => {
    const { tenant, project, ctx } = await setup();
    const doc = await createTestDocument(tenant.id, project.id);

    await expect(svc.openDocument(ctx, project.id, doc.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("client documents", () => {
  it("lists only the client's own project's documents", async () => {
    const { tenant, client, project, ctx } = await setup();
    const { documentId } = await upload(ctx, project.id, { title: "Contrato" });
    await upload(ctx, (await createTestProject(tenant.id)).id);
    const other = await setup();
    await upload(other.ctx, other.project.id);

    expect(await svc.listClientDocuments(tenant.id, client.id)).toEqual([
      {
        id: documentId,
        title: "Contrato",
        category: "contract",
        sizeBytes: pdf().size,
        uploadedAt: expect.any(String),
      },
    ]);
  });

  it("lists a category the app doesn't know as other, unless it asks for it", async () => {
    const { tenant, client, project } = await setup();
    await createTestDocument(tenant.id, project.id, { title: "Presupuesto", category: "budget" });

    expect((await svc.listClientDocuments(tenant.id, client.id))[0]).toMatchObject({ title: "Presupuesto", category: "other" });
    const current = await svc.listClientDocuments(tenant.id, client.id, ["contract", "plans", "certificates", "other", "budget"]);
    expect(current[0]).toMatchObject({ category: "budget" });
  });

  it("lists nothing for a client without a project", async () => {
    const { tenant, client, project, ctx } = await setup();
    await upload(ctx, project.id);
    await db.update(projects).set({ clientUserId: null }).where(eq(projects.id, project.id));

    expect(await svc.listClientDocuments(tenant.id, client.id)).toEqual([]);
  });

  it("opens the client's own document", async () => {
    const { tenant, client, project, ctx } = await setup();
    const { documentId } = await upload(ctx, project.id);

    const file = await svc.openClientDocument(tenant.id, client.id, documentId);

    expect(await text(file.body)).toBe("%PDF-1.7\ncontenido");
  });

  it("does not open another client's document", async () => {
    const { tenant, client } = await setup();
    const other = await setup();
    const { documentId } = await upload(other.ctx, other.project.id);
    const sameTenantProject = await createTestProject(tenant.id);
    const { documentId: unassigned } = await upload(
      { ...other.ctx, tenantId: tenant.id },
      sameTenantProject.id,
    );

    for (const [tenantId, id] of [
      [tenant.id, documentId],
      [other.tenant.id, documentId],
      [tenant.id, unassigned],
    ] as const) {
      await expect(svc.openClientDocument(tenantId, client.id, id)).rejects.toMatchObject({
        code: "not_found",
        status: 404,
      });
    }
  });
});

describe("visibility", () => {
  it("hides a document from the client's app and shows it again", async () => {
    const { tenant, client, project, ctx } = await setup();
    const doc = await createTestDocument(tenant.id, project.id);
    files.set(doc.pathname, pdf());

    await svc.setDocumentVisibility(ctx, project.id, doc.id, { visibleToClient: false });
    expect(await svc.listClientDocuments(tenant.id, client.id)).toEqual([]);
    await expect(svc.openClientDocument(tenant.id, client.id, doc.id)).rejects.toMatchObject({ code: "not_found" });
    // Staff still see and open it.
    expect((await svc.listDocuments(ctx, project.id))[0]).toMatchObject({ id: doc.id, visibleToClient: false });

    await svc.setDocumentVisibility(ctx, project.id, doc.id, { visibleToClient: true });
    expect((await svc.listClientDocuments(tenant.id, client.id)).map((d) => d.id)).toEqual([doc.id]);
  });

  it("only shows the app PDFs it can download", async () => {
    const { tenant, project, ctx } = await setup();
    const sheet = await createTestDocument(tenant.id, project.id, { visibleToClient: false, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const plans = await createTestDocument(tenant.id, project.id, { visibleToClient: false, sizeBytes: MAX_DOCUMENT_BYTES + 1 });

    await expect(svc.setDocumentVisibility(ctx, project.id, sheet.id, { visibleToClient: true })).rejects.toMatchObject({ code: "invalid_file_type" });
    await expect(svc.setDocumentVisibility(ctx, project.id, plans.id, { visibleToClient: true })).rejects.toMatchObject({ code: "file_too_large" });
    // Hiding is always allowed.
    await svc.setDocumentVisibility(ctx, project.id, plans.id, { visibleToClient: false });
  });

  it("is for editors of the document's own tenant", async () => {
    const { tenant, project, ctx } = await setup();
    const doc = await createTestDocument(tenant.id, project.id);
    const other = await setup();

    await expect(svc.setDocumentVisibility({ ...ctx, role: "viewer" }, project.id, doc.id, { visibleToClient: false })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.setDocumentVisibility(other.ctx, project.id, doc.id, { visibleToClient: false })).rejects.toMatchObject({ code: "project_not_found" });
    await expect(svc.setDocumentVisibility(other.ctx, other.project.id, doc.id, { visibleToClient: false })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.setDocumentVisibility(ctx, project.id, doc.id, {})).rejects.toMatchObject({ code: "missing_fields" });
  });
});

describe("budget inputs", () => {
  /** Asks for a pathname, "uploads" to it and registers the file. */
  async function uploadInput(ctx: Ctx, projectId: string, filename: string, content: string, budgetInput = "plans") {
    const { pathname } = await svc.budgetInputUpload(ctx, projectId, filename);
    files.set(pathname, new Blob([content]));
    return { pathname, ...(await svc.registerBudgetInput(ctx, projectId, { pathname, budgetInput, filename })) };
  }

  it("registers files the browser uploaded, staff-only", async () => {
    const { tenant, client, project, ctx } = await setup();

    const plans = await uploadInput(ctx, project.id, "Planos Arboleda.pdf", "%PDF-1.7 planos");
    const bc3 = await uploadInput(ctx, project.id, "mediciones.BC3", "~V|ANSI|", "measurements");

    const docs = await svc.listDocuments(ctx, project.id);
    expect(docs.find((d) => d.id === plans.documentId)).toMatchObject({
      title: "Planos Arboleda",
      category: "budget",
      budgetInput: "plans",
      visibleToClient: false,
      contentType: "application/pdf",
    });
    expect(docs.find((d) => d.id === bc3.documentId)).toMatchObject({ budgetInput: "measurements", filename: "mediciones.BC3" });
    expect(await svc.listClientDocuments(tenant.id, client.id)).toEqual([]);
    expect(plans.pathname).toMatch(new RegExp(`^tenants/${tenant.id}/projects/${project.id}/inputs/.+\\.pdf$`));
  });

  it("only takes allowed types, real PDFs and files under the project's own inputs", async () => {
    const { project, ctx } = await setup();
    const other = await setup();

    await expect(svc.budgetInputUpload(ctx, project.id, "virus.exe")).rejects.toMatchObject({ code: "invalid_file_type" });
    await expect(uploadInput(ctx, project.id, "planos.pdf", "not a pdf")).rejects.toMatchObject({ code: "invalid_file_type" });
    const { pathname } = await svc.budgetInputUpload(ctx, project.id, "planos.pdf");
    // Never uploaded.
    await expect(svc.registerBudgetInput(ctx, project.id, { pathname, budgetInput: "plans", filename: "planos.pdf" })).rejects.toMatchObject({ code: "missing_file" });
    // Another project's upload.
    files.set(pathname, new Blob(["%PDF-1.7"]));
    await expect(svc.registerBudgetInput(other.ctx, other.project.id, { pathname, budgetInput: "plans", filename: "planos.pdf" })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.registerBudgetInput(ctx, project.id, { pathname, budgetInput: "fotos", filename: "planos.pdf" })).rejects.toMatchObject({ code: "invalid_category" });
    await expect(svc.budgetInputUpload({ ...ctx, role: "viewer" }, project.id, "planos.pdf")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("takes a document already on the project as an input, keeping its visibility", async () => {
    const { tenant, project, ctx } = await setup();
    const doc = await createTestDocument(tenant.id, project.id, { title: "Planos visados", category: "plans" });
    const other = await setup();

    await svc.markBudgetInput(ctx, project.id, doc.id, { budgetInput: "plans" });

    expect((await svc.listDocuments(ctx, project.id))[0]).toMatchObject({ budgetInput: "plans", visibleToClient: true, category: "plans" });
    await expect(svc.markBudgetInput(ctx, project.id, doc.id, { budgetInput: "x" })).rejects.toMatchObject({ code: "invalid_category" });
    await expect(svc.markBudgetInput(other.ctx, other.project.id, doc.id, { budgetInput: "plans" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("can be swapped until the AI reads them or the project has a budget", async () => {
    const { project, ctx } = await setup();
    const first = await uploadInput(ctx, project.id, "planos.pdf", "%PDF-1.7 a");
    await svc.deleteDocument(ctx, project.id, first.documentId);
    expect(files.has(first.pathname)).toBe(false);

    const second = await uploadInput(ctx, project.id, "planos.pdf", "%PDF-1.7 b");
    const { generationId } = await budgetGenerationsService.startGeneration(ctx, project.id, { documentIds: [second.documentId] });
    // Not while the AI reads it.
    await expect(svc.deleteDocument(ctx, project.id, second.documentId)).rejects.toMatchObject({ code: "generation_running" });
    await budgetGenerationsService.cancelGeneration(ctx, project.id, generationId);
    await budgetService.createBudget(ctx, project.id, {});
    await expect(svc.deleteDocument(ctx, project.id, second.documentId)).rejects.toMatchObject({ code: "budget_document", status: 409 });
  });
});

describe("deleteProject", () => {
  it("also deletes the project's stored files", async () => {
    const { project, ctx } = await setup();
    await upload(ctx, project.id);
    const other = await setup();
    await upload(other.ctx, other.project.id);

    await projectsService.deleteProject(ctx, project.id);

    expect([...files.keys()]).toEqual([expect.stringContaining(other.project.id)]);
  });
});
