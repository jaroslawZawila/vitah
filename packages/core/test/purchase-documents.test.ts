import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { db, eq, purchaseOrders, sql } from "@repo/db";
import {
  budgetService,
  purchaseDocumentsService as svc,
  purchasingService,
  subcontractorsService,
  type Ctx,
} from "../src";
import { files, putFile } from "../src/testing";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));

const pdf = (content = "%PDF-1.7 contrato", name = "Contrato.pdf") => new File([content], name, { type: "application/pdf" });
const text = async (file: { body: ReadableStream | Blob | null }) => new Response(file.body).text();

/** A project with an accepted budget, a material supplier and one order of theirs. */
async function setup(role: Ctx["role"] = "manager") {
  const tenant = await createTestTenant();
  const admin: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" };
  const user = await createTestUser(tenant.id, { role, name: "Laura Pérez" });
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role };
  const project = await createTestProject(tenant.id);
  const { revisionId } = await framerDraft(admin, project.id, ["01"]);
  await budgetService.acceptRevision(admin, project.id, revisionId);
  const { id: supplierId } = await subcontractorsService.createSubcontractor(admin, {
    kind: "company",
    legalName: "Piedra de Liébana S.L.",
    taxId: "B39654322",
    address: "Barrio La Serna 7",
    postalCode: "39570",
    city: "Potes",
    suppliesOnly: true,
  });
  const form = await purchasingService.getPurchaseForm(admin, project.id);
  const { orderId } = await purchasingService.createPurchase(admin, project.id, {
    kind: "material",
    subcontractorId: supplierId,
    description: "Piedra",
    lines: [{ lineageId: form.chapters[0]!.lines[0]!.lineageId, amountCents: 1_000 }],
  });
  return { tenant, admin, ctx, project, orderId };
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

afterEach(() => vi.useRealTimers());

describe("an order's documents", () => {
  it("keeps several documents, each in versions, the newest current and none overwritten", async () => {
    const s = await setup();
    const contract = await svc.addOrderDocument(s.ctx, s.orderId, { title: "Contrato firmado", file: pdf("%PDF-1.7 v1") });
    expect(contract.version).toBe(1);
    await svc.addOrderDocument(s.ctx, s.orderId, { title: "Anexo I · mediciones", file: pdf("%PDF-1.7 anexo", "Anexo.pdf") });
    const second = await svc.addOrderDocumentVersion(s.ctx, s.orderId, contract.documentId, {
      file: pdf("%PDF-1.7 v2", "Contrato v2.pdf"),
      note: "Firmado por las dos partes",
    });
    expect(second).toEqual({ documentId: contract.documentId, version: 2 });
    expect(files.size).toBe(3);

    const order = await purchasingService.getPurchase(s.ctx, s.orderId);
    expect(order.documents.map((d) => [d.title, d.versions.map((v) => [v.version, v.filename, v.note, v.by])])).toEqual([
      ["Contrato firmado", [[2, "Contrato v2.pdf", "Firmado por las dos partes", "Laura Pérez"], [1, "Contrato.pdf", null, "Laura Pérez"]]],
      ["Anexo I · mediciones", [[1, "Anexo.pdf", null, "Laura Pérez"]]],
    ]);
    // What older clients read: the first document's current version.
    expect(order).toMatchObject({ hasFile: true, file: { name: "Contrato v2.pdf" } });
    expect(order.events.slice(0, 3).map((e) => e.action)).toEqual(["document_version_added", "document_added", "document_added"]);
    expect(order.events[0]).toMatchObject({ detail: { title: "Contrato firmado", version: 2 }, note: "Firmado por las dos partes" });

    expect(await text(await svc.openOrderDocument(s.ctx, s.orderId, contract.documentId))).toBe("%PDF-1.7 v2");
    const older = order.documents[0]!.versions[1]!.id;
    expect(await text(await svc.openOrderDocument(s.ctx, s.orderId, contract.documentId, older))).toBe("%PDF-1.7 v1");
    const listed = await purchasingService.getProjectPurchases(s.ctx, s.project.id);
    expect(listed.orders[0]?.hasFile).toBe(true);
  });

  it("removes a document with all its versions", async () => {
    const s = await setup();
    const { documentId } = await svc.addOrderDocument(s.ctx, s.orderId, { title: "Oferta", file: pdf() });
    await svc.addOrderDocumentVersion(s.ctx, s.orderId, documentId, { file: pdf("%PDF-1.7 v2") });
    await svc.deleteOrderDocument(s.ctx, s.orderId, documentId);
    expect(files.size).toBe(0);
    const order = await purchasingService.getPurchase(s.ctx, s.orderId);
    expect(order).toMatchObject({ documents: [], hasFile: false, file: null });
    expect(order.events[0]).toMatchObject({ action: "document_removed", detail: { title: "Oferta", versions: 2 } });
    await expect(svc.openOrderDocument(s.ctx, s.orderId, documentId)).rejects.toMatchObject({ code: "not_found" });
  });

  it("checks the title, the file and that the document is the order's", async () => {
    const s = await setup();
    await expect(svc.addOrderDocument(s.ctx, s.orderId, { title: " ", file: pdf() })).rejects.toMatchObject({ code: "missing_fields" });
    await expect(svc.addOrderDocument(s.ctx, s.orderId, { title: "Contrato" })).rejects.toMatchObject({ code: "missing_file" });
    await expect(
      svc.addOrderDocument(s.ctx, s.orderId, { title: "Contrato", file: new File(["hola"], "x.pdf") }),
    ).rejects.toMatchObject({ code: "invalid_file_type" });
    const other = await purchasingService.createPurchase(s.admin, s.project.id, {
      kind: "material",
      subcontractorId: (await purchasingService.getPurchase(s.admin, s.orderId)).subcontractorId,
      description: "Otro",
      lines: (await purchasingService.getPurchase(s.admin, s.orderId)).lines.map((l) => ({ lineageId: l.lineageId, amountCents: 1 })),
    });
    const { documentId } = await svc.addOrderDocument(s.ctx, other.orderId, { title: "Contrato", file: pdf() });
    await expect(svc.addOrderDocumentVersion(s.ctx, s.orderId, documentId, { file: pdf() })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.deleteOrderDocument(s.ctx, s.orderId, documentId)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("the single PDF older clients know", () => {
  it("is the first document: uploading versions it, deleting removes it", async () => {
    const s = await setup();
    await svc.uploadPurchaseFile(s.ctx, s.orderId, { file: pdf("%PDF-1.7 v1", "Pedido PED-001.pdf") });
    await svc.uploadPurchaseFile(s.ctx, s.orderId, { file: pdf("%PDF-1.7 v2", "Pedido PED-001.pdf") });
    await svc.addOrderDocument(s.ctx, s.orderId, { title: "Anexo", file: pdf("%PDF-1.7 anexo") });

    const order = await purchasingService.getPurchase(s.ctx, s.orderId);
    expect(order.documents.map((d) => [d.title, d.versions.length])).toEqual([
      ["Pedido PED-001", 2],
      ["Anexo", 1],
    ]);
    expect(await text(await svc.openPurchaseFile(s.ctx, s.orderId))).toBe("%PDF-1.7 v2");

    await svc.deletePurchaseFile(s.ctx, s.orderId);
    expect(await text(await svc.openPurchaseFile(s.ctx, s.orderId))).toBe("%PDF-1.7 anexo");
    await svc.deletePurchaseFile(s.ctx, s.orderId);
    await expect(svc.openPurchaseFile(s.ctx, s.orderId)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("the prod migration (2026-10-purchase-documents.sql)", () => {
  const migration = readFileSync(new URL("../../db/sql/2026-10-purchase-documents.sql", import.meta.url), "utf8");

  it("turns an order's single PDF into its first document, once, and a removed one stays removed", async () => {
    const s = await setup();
    const pathname = `tenants/${s.tenant.id}/projects/${s.project.id}/purchases/${s.orderId}/legacy.pdf`;
    await putFile(pathname, pdf("%PDF-1.7 legado"), "application/pdf");
    await db.update(purchaseOrders).set({ fileName: "Pedido_PED-001.pdf", filePathname: pathname, fileSizeBytes: 15 }).where(eq(purchaseOrders.id, s.orderId));

    await db.execute(sql.raw(migration));
    await db.execute(sql.raw(migration));
    const order = await purchasingService.getPurchase(s.ctx, s.orderId);
    expect(order.documents).toMatchObject([{ title: "Pedido_PED-001", versions: [{ version: 1, filename: "Pedido_PED-001.pdf", sizeBytes: 15 }] }]);
    expect(await text(await svc.openPurchaseFile(s.ctx, s.orderId))).toBe("%PDF-1.7 legado");

    await svc.deleteOrderDocument(s.ctx, s.orderId, order.documents[0]!.id);
    await db.execute(sql.raw(migration));
    expect((await purchasingService.getPurchase(s.ctx, s.orderId)).documents).toEqual([]);
  });

  it("names a document after nothing 'pedido', and catches up with a PDF the old code replaced", async () => {
    const s = await setup();
    const legacy = (name: string) => `tenants/${s.tenant.id}/projects/${s.project.id}/purchases/${s.orderId}/${name}`;
    await putFile(legacy("a.pdf"), pdf("%PDF-1.7 a"), "application/pdf");
    await putFile(legacy("b.pdf"), pdf("%PDF-1.7 b"), "application/pdf");
    await db.update(purchaseOrders).set({ fileName: ".pdf", filePathname: legacy("a.pdf"), fileSizeBytes: 10 }).where(eq(purchaseOrders.id, s.orderId));
    await db.execute(sql.raw(migration));
    // The old code, still live for a moment, replaces the PDF; the run after the deploy catches up.
    await db.update(purchaseOrders).set({ fileName: "nuevo.pdf", filePathname: legacy("b.pdf"), fileSizeBytes: 10 }).where(eq(purchaseOrders.id, s.orderId));
    await db.execute(sql.raw(migration));

    const order = await purchasingService.getPurchase(s.ctx, s.orderId);
    expect(order.documents).toMatchObject([{ title: "pedido", versions: [{ version: 1, filename: "nuevo.pdf" }] }]);
    expect(await text(await svc.openPurchaseFile(s.ctx, s.orderId))).toBe("%PDF-1.7 b");
  });
});

describe("access", () => {
  it("lets viewers download but not upload or remove", async () => {
    const s = await setup("viewer");
    const { documentId } = await svc.addOrderDocument(s.admin, s.orderId, { title: "Contrato", file: pdf() });
    expect(await text(await svc.openOrderDocument(s.ctx, s.orderId, documentId))).toBe("%PDF-1.7 contrato");
    await expect(svc.addOrderDocument(s.ctx, s.orderId, { title: "X", file: pdf() })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.addOrderDocumentVersion(s.ctx, s.orderId, documentId, { file: pdf() })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.deleteOrderDocument(s.ctx, s.orderId, documentId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.uploadPurchaseFile(s.ctx, s.orderId, { file: pdf() })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("keeps tenants apart", async () => {
    const s = await setup();
    const { documentId } = await svc.addOrderDocument(s.ctx, s.orderId, { title: "Contrato", file: pdf() });
    const other = await createTestTenant();
    const stranger: Ctx = { tenantId: other.id, userId: (await createTestUser(other.id, { role: "admin" })).id, role: "admin" };
    for (const attempt of [
      () => svc.openOrderDocument(stranger, s.orderId, documentId),
      () => svc.addOrderDocument(stranger, s.orderId, { title: "X", file: pdf() }),
      () => svc.addOrderDocumentVersion(stranger, s.orderId, documentId, { file: pdf() }),
      () => svc.deleteOrderDocument(stranger, s.orderId, documentId),
      () => svc.openPurchaseFile(stranger, s.orderId),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "not_found" });
    }
  });
});
