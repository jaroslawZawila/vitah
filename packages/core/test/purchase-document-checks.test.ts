import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { db, eq, purchaseDocumentChecks, purchaseOrderDocumentVersions, sql, tenants } from "@repo/db";
import {
  budgetService,
  purchaseChecksService as svc,
  purchaseDocumentsService,
  purchaseInvoicesService,
  purchasingService,
  subcontractorsService,
  type Ctx,
} from "../src";
import { ClaudeError, structuredCall } from "../src/budget-ai/claude";
import { files } from "../src/testing";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));
vi.mock("../src/budget-ai/claude", async (importActual) => ({
  ...(await importActual<typeof import("../src/budget-ai/claude")>()),
  structuredCall: vi.fn(),
}));
const claude = vi.mocked(structuredCall);

const pdf = (content: string, name = "doc.pdf") => new File([`%PDF-1.7 ${content}`], name, { type: "application/pdf" });

/** A project with an accepted budget, a supplier and a placed order of 1.000 €. */
async function setup(role: Ctx["role"] = "manager") {
  const tenant = await createTestTenant();
  const admin: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin", name: "Ana Admin" })).id, role: "admin" };
  const user = await createTestUser(tenant.id, { role, name: "Laura Pérez" });
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role };
  const project = await createTestProject(tenant.id, { ref: `VTH-${tenant.id.slice(0, 4)}`, address: "Barrio Caviedes 12" });
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
    status: "ordered",
    orderedOn: "2026-10-01",
    lines: [{ lineageId: form.chapters[0]!.lines[0]!.lineageId, amountCents: 100_000 }],
  });
  return { tenant, admin, ctx, project, orderId };
}

const amountWarning = { kind: "amount_mismatch" as const, detail_es: "El PDF dice 1.200 €; el pedido, 1.000 €.", detail_en: "The PDF says €1,200; the order, €1,000." };

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  claude.mockReset().mockResolvedValue({ findings: [] });
});

afterEach(() => vi.useRealTimers());

describe("the AI's review of purchase documents", () => {
  it("reviews a new order document against its order, and keeps what it warns of", async () => {
    const s = await setup();
    await purchaseDocumentsService.addOrderDocument(s.ctx, s.orderId, { title: "Pedido firmado", file: pdf("pedido") });
    expect((await purchasingService.getPurchase(s.ctx, s.orderId)).checks).toEqual([]);
    await svc.queueNewChecks(s.ctx);
    await svc.queueNewChecks(s.ctx);
    expect((await purchasingService.getPurchase(s.ctx, s.orderId)).checks).toMatchObject([{ status: "pending", label: "Pedido firmado · v1" }]);

    claude.mockResolvedValueOnce({ findings: [amountWarning] });
    expect(await svc.runPendingChecks(s.ctx)).toBe(1);
    const [check] = (await purchasingService.getPurchase(s.ctx, s.orderId)).checks;
    expect(check).toMatchObject({
      subject: "order_document",
      status: "done",
      findings: [{ kind: "amount_mismatch", detail: { es: amountWarning.detail_es, en: amountWarning.detail_en } }],
      checkedAt: expect.any(String),
    });
    // Claude gets the PDF and the order's facts; the call is staff-scoped and logged under its purpose.
    const [options, context] = claude.mock.calls[0]!;
    // A quick check: Haiku, without effort or a fallback model.
    expect(options).toMatchObject({ model: "claude-haiku-4-5-20251001", fallback: false });
    expect(options.effort).toBeUndefined();
    expect(options.content[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf" } });
    expect(JSON.stringify(options.content[1])).toContain("Piedra de Liébana S.L. (CIF/NIF B39654322)");
    expect(JSON.stringify(options.content[1])).toContain("importe actual 1000.00 € sin IVA");
    expect(context).toMatchObject({ tenantId: s.tenant.id, projectId: s.project.id, generationId: null, purpose: "purchase.check" });
    // Nothing left: a second run does nothing.
    expect(await svc.runPendingChecks(s.ctx)).toBe(0);
  });

  it("reviews an invoice's PDF and a payment's proof, shown on the invoice", async () => {
    const s = await setup();
    const { invoiceId } = await purchaseInvoicesService.createInvoice(s.admin, s.orderId, { number: "PL-0815", issuedOn: "2026-10-02", baseCents: 100_000, file: pdf("factura", "PL-0815.pdf") });
    await purchaseInvoicesService.createPayment(s.admin, invoiceId, { amountCents: 50_000, paidOn: "2026-10-10", file: pdf("transferencia", "Justificante.pdf") });
    await svc.queueNewChecks(s.ctx);
    await svc.runPendingChecks(s.ctx);
    const { checks } = await purchaseInvoicesService.getInvoice(s.ctx, invoiceId);
    expect(checks.map((c) => [c.subject, c.label, c.status]).sort()).toEqual([
      ["invoice_file", "PL-0815 · v1", "done"],
      ["payment_proof", "Justificante.pdf", "done"],
    ]);
    const facts = claude.mock.calls.map(([options]) => JSON.stringify(options.content[1]));
    expect(facts.some((f) => f.includes("Factura PL-0815 del 2026-10-02") && f.includes("total 1210.00 €"))).toBe(true);
    expect(facts.some((f) => f.includes("Justificante de un pago de 500.00 € el 2026-10-10"))).toBe(true);
    // The order's page shows its documents' reviews only.
    expect((await purchasingService.getPurchase(s.ctx, s.orderId)).checks).toEqual([]);
  });

  it("warns of the same file uploaded twice", async () => {
    const s = await setup();
    await purchaseDocumentsService.addOrderDocument(s.ctx, s.orderId, { title: "Contrato", file: pdf("mismo") });
    await svc.queueNewChecks(s.ctx);
    await svc.runPendingChecks(s.ctx);
    await purchaseDocumentsService.addOrderDocument(s.ctx, s.orderId, { title: "Contrato (otra vez)", file: pdf("mismo") });
    await svc.queueNewChecks(s.ctx);
    await svc.runPendingChecks(s.ctx);
    const [latest] = (await purchasingService.getPurchase(s.ctx, s.orderId)).checks;
    expect(latest!.findings).toEqual([
      { kind: "duplicate", detail: null, duplicate: { label: "Contrato · v1", orderId: s.orderId, projectId: s.project.id, invoiceId: null } },
    ]);
  });

  it("keeps a duplicate warning when the review fails, and a missing file fails it without stopping the rest", async () => {
    const s = await setup();
    await purchaseDocumentsService.addOrderDocument(s.ctx, s.orderId, { title: "A", file: pdf("igual") });
    await purchaseDocumentsService.addOrderDocument(s.ctx, s.orderId, { title: "B", file: pdf("igual") });
    await purchaseDocumentsService.addOrderDocument(s.ctx, s.orderId, { title: "C", file: pdf("perdido") });
    // C's file is gone from the store.
    const [lost] = await db.select().from(purchaseOrderDocumentVersions).where(sql`${purchaseOrderDocumentVersions.filename} = 'doc.pdf'`).orderBy(sql`created_at desc`).limit(1);
    files.delete(lost!.pathname);
    await svc.queueNewChecks(s.ctx);
    claude.mockResolvedValueOnce({ findings: [] }).mockRejectedValueOnce(new ClaudeError("too_many_pages", "Too long"));
    expect(await svc.runPendingChecks(s.ctx)).toBe(3);
    const checks = (await purchasingService.getPurchase(s.ctx, s.orderId)).checks;
    const byLabel = new Map(checks.map((c) => [c.label, c]));
    expect(byLabel.get("C · v1")).toMatchObject({ status: "failed", findings: [] });
    // A and B are the same file: whichever Claude failed on still warns of the other.
    const failed = [byLabel.get("A · v1")!, byLabel.get("B · v1")!].find((c) => c.status === "failed")!;
    expect(failed.findings.map((f) => f.kind)).toEqual(["duplicate"]);
  });

  it("past the monthly AI limit looks for duplicates only, and reviews the skipped ones once there is room", async () => {
    const s = await setup();
    await db.update(tenants).set({ aiMonthlyLimitCents: 0 }).where(eq(tenants.id, s.tenant.id));
    await purchaseDocumentsService.addOrderDocument(s.ctx, s.orderId, { title: "A", file: pdf("igual") });
    await purchaseDocumentsService.addOrderDocument(s.ctx, s.orderId, { title: "B", file: pdf("igual") });
    await svc.queueNewChecks(s.ctx);
    expect(await svc.runPendingChecks(s.ctx)).toBe(2);
    expect(claude).not.toHaveBeenCalled();
    let checks = (await purchasingService.getPurchase(s.ctx, s.orderId)).checks;
    expect(checks.map((c) => [c.label, c.status, c.reason, c.findings.map((f) => f.kind)]).sort()).toEqual([
      // The later upload is the duplicate.
      ["A · v1", "skipped", "ai_limit", []],
      ["B · v1", "skipped", "ai_limit", ["duplicate"]],
    ]);

    await db.update(tenants).set({ aiMonthlyLimitCents: null }).where(eq(tenants.id, s.tenant.id));
    expect(await svc.runPendingChecks(s.ctx)).toBe(2);
    expect(claude).toHaveBeenCalledTimes(2);
    checks = (await purchasingService.getPurchase(s.ctx, s.orderId)).checks;
    expect(checks.every((c) => c.status === "done" && c.findings[0]?.kind === "duplicate")).toBe(true);
  });

  it("reviews everything waiting in one run, and takes again a check left running by a crash", async () => {
    const s = await setup();
    for (const title of ["A", "B", "C", "D", "E"]) {
      await purchaseDocumentsService.addOrderDocument(s.ctx, s.orderId, { title, file: pdf(title) });
    }
    await svc.queueNewChecks(s.ctx);
    expect(await svc.runPendingChecks(s.ctx)).toBe(5);

    const [check] = (await purchasingService.getPurchase(s.ctx, s.orderId)).checks;
    await db.update(purchaseDocumentChecks).set({ status: "running", startedAt: sql`now() - interval '20 minutes'` }).where(eq(purchaseDocumentChecks.id, check!.id));
    expect(await svc.runPendingChecks(s.ctx)).toBe(1);
    expect((await purchasingService.getPurchase(s.ctx, s.orderId)).checks[0]!.status).toBe("done");
  });

  it("gives Claude the original contract and the modificados, and says which one a PDF is", async () => {
    const s = await setup();
    const { purchaseAmendmentsService } = await import("../src");
    const [line] = (await purchasingService.getPurchase(s.ctx, s.orderId)).lines;
    await purchaseAmendmentsService.amendPurchase(s.admin, s.orderId, {
      concept: "Más piedra",
      signedOn: "2026-10-05",
      lines: [{ lineageId: line!.lineageId, amountCents: 120_000 }],
      file: pdf("modificado"),
      documentTitle: "Modificado nº {n}",
    });
    await svc.queueNewChecks(s.ctx);
    await svc.runPendingChecks(s.ctx);
    const facts = JSON.stringify(claude.mock.calls[0]![0].content[1]);
    expect(facts).toContain("importe actual 1200.00 € sin IVA");
    expect(facts).toContain("Importe original del contrato: 1000.00 € sin IVA. Modificados: nº 1 del 2026-10-05, de 1000.00 € a 1200.00 €");
    expect(facts).toContain("Este documento es el modificado nº 1");
  });

  it("leaves files from before the last day to be asked for", async () => {
    const s = await setup();
    await purchaseDocumentsService.addOrderDocument(s.ctx, s.orderId, { title: "Antiguo", file: pdf("viejo") });
    await db.update(purchaseOrderDocumentVersions).set({ createdAt: sql`now() - interval '2 days'` });
    expect(await svc.runPendingChecks(s.ctx)).toBe(0);
    expect(await db.select().from(purchaseDocumentChecks)).toEqual([]);
  });

  it("is asked again, or its warnings marked as seen, by admins and managers only", async () => {
    const s = await setup();
    await purchaseDocumentsService.addOrderDocument(s.ctx, s.orderId, { title: "Pedido", file: pdf("p") });
    claude.mockResolvedValueOnce({ findings: [amountWarning] });
    await svc.queueNewChecks(s.ctx);
    await svc.runPendingChecks(s.ctx);
    const [check] = (await purchasingService.getPurchase(s.ctx, s.orderId)).checks;

    await svc.dismissCheck(s.ctx, check!.id);
    expect((await purchasingService.getPurchase(s.ctx, s.orderId)).checks[0]).toMatchObject({ dismissedAt: expect.any(String), dismissedBy: "Laura Pérez" });
    await svc.recheckDocument(s.ctx, check!.id);
    expect((await purchasingService.getPurchase(s.ctx, s.orderId)).checks[0]).toMatchObject({ status: "pending", findings: [], dismissedAt: null });
    // Still waiting: it just runs. Under way: not again.
    expect(await svc.recheckDocument(s.ctx, check!.id)).toEqual({ checkId: check!.id });
    await expect(svc.dismissCheck(s.ctx, check!.id)).rejects.toMatchObject({ code: "invalid_state" });
    await db.update(purchaseDocumentChecks).set({ status: "running", startedAt: new Date() }).where(eq(purchaseDocumentChecks.id, check!.id));
    await expect(svc.recheckDocument(s.ctx, check!.id)).rejects.toMatchObject({ code: "invalid_state" });
    await db.update(purchaseDocumentChecks).set({ status: "pending" }).where(eq(purchaseDocumentChecks.id, check!.id));
    await svc.runPendingChecks(s.ctx);
    expect((await purchasingService.getPurchase(s.ctx, s.orderId)).checks[0]).toMatchObject({ status: "done", findings: [] });

    const viewer: Ctx = { ...s.ctx, userId: (await createTestUser(s.tenant.id, { role: "viewer" })).id, role: "viewer" };
    await expect(svc.recheckDocument(viewer, check!.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.dismissCheck(viewer, check!.id)).rejects.toMatchObject({ code: "forbidden" });

    const other = await setup();
    await expect(svc.recheckDocument(other.ctx, check!.id)).rejects.toMatchObject({ code: "not_found" });
    // Another tenant's run never takes this tenant's checks.
    await svc.recheckDocument(s.ctx, check!.id);
    expect(await svc.runPendingChecks(other.ctx)).toBe(0);
    expect((await purchasingService.getPurchase(s.ctx, s.orderId)).checks[0]!.status).toBe("pending");
  });
});
