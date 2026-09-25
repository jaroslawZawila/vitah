import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, projectDocuments, projects } from "@repo/db";
import {
  createTestDocument,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { MAX_DOCUMENT_BYTES, documentsService as svc, projectsService, type Ctx } from "../src";
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
      },
      {
        id: older.id,
        title: "Planos",
        category: "plans",
        sizeBytes: 2048,
        uploadedAt: "2026-01-01T10:00:00.000Z",
        uploadedBy: null,
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

    expect(file).toMatchObject({ title: "Contrato", sizeBytes: pdf().size });
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
