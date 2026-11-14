import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDocument,
  createTestPhoto,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import {
  and,
  db,
  eq,
  projectDocuments,
  projects,
  purchaseInvoices,
  purchaseOrderEvents,
  purchasePayments,
  sql,
  subcontractorAssignments,
  subcontractorAudit,
} from "@repo/db";
import {
  budgetService,
  clientAccountService,
  constructionService,
  deletedService as svc,
  documentsService,
  photosService,
  projectsService,
  purchaseDocumentsService,
  purchaseInvoicesService as invoices,
  purchaseSuppliersService,
  purchasingService,
  subcontractorsService,
  type Ctx,
  type DeletedItem,
  type DeletedKind,
} from "../src";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../src/contract";
import { files } from "../src/testing";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));
vi.mock("../src/push", () => ({ sendPush: vi.fn(async () => []) }));
const { sendPush } = await import("../src/push");

const pdf = (name = "documento.pdf") => new File(["%PDF-1.7 contenido"], name, { type: "application/pdf" });

/** Deletions a minute apart, so "newest first" has an order. */
const tick = () => vi.advanceTimersByTime(60_000);

/** A tenant with an admin and a manager, and an obra with its client (who has a phone registered). */
async function base() {
  const tenant = await createTestTenant();
  const adminUser = await createTestUser(tenant.id, { role: "admin", name: "Ana Admin" });
  const managerUser = await createTestUser(tenant.id, { role: "manager", name: "Laura Pérez" });
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, {
    ref: "VTH-26-001",
    address: "Calle Alta 12, Santander",
    clientUserId: client.id,
    startDate: new Date("2026-06-01T00:00:00Z"),
    completionDate: new Date("2027-03-31T00:00:00Z"),
  });
  await clientAccountService.registerPushToken(tenant.id, client.id, { token: "ExponentPushToken[phone-1]" });
  vi.mocked(sendPush).mockClear();
  const admin: Ctx = { tenantId: tenant.id, userId: adminUser.id, role: "admin" };
  const manager: Ctx = { tenantId: tenant.id, userId: managerUser.id, role: "manager" };
  return { tenant, admin, manager, client, project };
}

type Base = Awaited<ReturnType<typeof base>>;

const company = (overrides: Record<string, unknown> = {}) => ({
  kind: "company",
  legalName: "Montajes Steel Norte S.L.",
  taxId: "B39123450",
  address: "Polígono Raos 4",
  postalCode: "39600",
  city: "Maliaño",
  ...overrides,
});

/**
 * The obra with an accepted budget of chapters 01–03 (1.000 € at cost each),
 * a subcontract of line 03 (980 €, 5 % retention) and an order of material
 * for lines 01 and 02 (950 € + 500 €), both placed.
 */
async function withPurchasing(s: Base) {
  const { admin, project } = s;
  const { revisionId } = await framerDraft(admin, project.id, ["01", "02", "03"]);
  await budgetService.acceptRevision(admin, project.id, revisionId, {}, { unissued: true });
  const { id: subcontractorId } = await subcontractorsService.createSubcontractor(admin, company());
  const { id: supplierId } = await subcontractorsService.createSubcontractor(
    admin,
    company({ legalName: "Piedra de Liébana S.L.", taxId: "B39654322", suppliesOnly: true }),
  );
  const form = await purchasingService.getPurchaseForm(admin, project.id);
  const lineage = (code: string) => form.chapters.find((c) => c.code === code)!.lines[0]!.lineageId;
  const sub = await purchasingService.createPurchase(admin, project.id, {
    kind: "subcontract",
    subcontractorId,
    description: "Estructura Steel Frame",
    status: "contracted",
    orderedOn: "2026-06-18",
    retentionBp: 500,
    lines: [{ lineageId: lineage("03"), amountCents: 98_000 }],
  });
  const material = await purchasingService.createPurchase(admin, project.id, {
    kind: "material",
    subcontractorId: supplierId,
    description: "Hormigón y lámina",
    status: "ordered",
    orderedOn: "2026-06-01",
    lines: [
      { lineageId: lineage("01"), amountCents: 95_000 },
      { lineageId: lineage("02"), amountCents: 50_000 },
    ],
  });
  vi.mocked(sendPush).mockClear();
  return { ...s, subcontractorId, supplierId, lineage, subId: sub.orderId, materialId: material.orderId };
}

type Purchasing = Awaited<ReturnType<typeof withPurchasing>>;

const invoice = (overrides: Record<string, unknown> = {}) => ({
  number: "MSN-2026/112",
  issuedOn: "2026-09-22",
  baseCents: 49_000,
  ...overrides,
});

const issue = () => ({
  kind: "issue",
  occurredOn: "2026-10-08",
  chapterCode: "02",
  description: "Retraso en el suministro del panel",
  party: "other",
});

/** The subcontract's invoice (490 € of its 980 €), registered by the manager. */
const addInvoice = async (s: Purchasing, overrides: Record<string, unknown> = {}) =>
  (await invoices.createInvoice(s.manager, s.subId, invoice(overrides))).invoiceId;

const list = async (ctx: Ctx, filters: Record<string, unknown> = {}) => (await svc.listDeleted(ctx, filters)).items;
const find = async (ctx: Ctx, kind: DeletedKind, id: string) => (await list(ctx, { kind })).find((i) => i.id === id);

/** What Compras shows of the money, whole: the suppliers' figures, the invoices' totals, the obra's lines and both orders. */
async function figures(s: Purchasing) {
  const order = async (orderId: string) => {
    const { invoicing, invoices: orderInvoices, milestones, invoicedCents } = await purchasingService.getPurchase(s.admin, orderId);
    return { invoicing, invoices: orderInvoices, milestones, invoicedCents };
  };
  const [suppliers, { invoices: all, summary }, payments, lines, sub, material] = await Promise.all([
    purchaseSuppliersService.listSuppliers(s.admin),
    invoices.listInvoices(s.admin),
    invoices.listPayments(s.admin),
    purchasingService.getProjectPurchaseLines(s.admin, s.project.id),
    order(s.subId),
    order(s.materialId),
  ]);
  return { suppliers, invoices: all, summary, payments: payments.payments, forecast: payments.forecast, lines, sub, material };
}

/** The log lines written with `event`. */
function logged(spy: { mock: { calls: unknown[][] } }, event: string) {
  return spy.mock.calls
    .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
    .filter((line) => line.event === event);
}

const events = (orderId: string, action: string) =>
  db
    .select()
    .from(purchaseOrderEvents)
    .where(and(eq(purchaseOrderEvents.orderId, orderId), eq(purchaseOrderEvents.action, action)));

async function counters(projectId: string) {
  const [row] = await db
    .select({ project: projects.projectRev, obra: projects.obraRev, photos: projects.photosRev, documents: projects.documentsRev })
    .from(projects)
    .where(eq(projects.id, projectId));
  return row!;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
  vi.mocked(sendPush).mockReset().mockResolvedValue([]);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("listDeleted", () => {
  it("lists each kind of deleted record as a person knows it, with who deleted it, newest first", async () => {
    const s = await withPurchasing(await base());
    const { tenant, admin, manager, project } = s;
    const obra = { projectId: project.id, projectRef: "VTH-26-001", restorable: true as const, parent: null };
    const byLaura = { id: manager.userId, name: "Laura Pérez" };

    const { documentId } = await documentsService.addDocument(manager, project.id, { title: "Contrato de obra", category: "contract", file: pdf() });
    await documentsService.deleteDocument(manager, project.id, documentId);
    tick();
    const photo = await createTestPhoto(tenant.id, project.id, { caption: "Fachada sur", takenOn: "2026-10-08" });
    const bare = await createTestPhoto(tenant.id, project.id, { caption: null, takenOn: "2026-10-09" });
    await photosService.deletePhoto(manager, project.id, photo.id);
    tick();
    await photosService.deletePhoto(manager, project.id, bare.id);
    tick();
    const { issueId } = await constructionService.createIssue(manager, project.id, issue());
    const { fileId } = await constructionService.addIssueFile(manager, project.id, issueId, { file: pdf("correo-proveedor.pdf") });
    await constructionService.deleteIssueFile(manager, project.id, issueId, fileId);
    tick();
    await subcontractorsService.assignToProject(admin, s.subcontractorId, project.id, { chapterCodes: ["03"] });
    await subcontractorsService.removeAssignment(manager, s.subcontractorId, project.id);
    const [assignment] = await db.select().from(subcontractorAssignments);
    tick();
    const orderDocument = await purchaseDocumentsService.addOrderDocument(manager, s.subId, { title: "Contrato firmado", file: pdf() });
    await purchaseDocumentsService.deleteOrderDocument(manager, s.subId, orderDocument.documentId);
    tick();
    const invoiceId = await addInvoice(s);
    const { paymentId } = await invoices.createPayment(manager, invoiceId, { amountCents: 20_000, paidOn: "2026-10-15" });
    await invoices.deletePayment(manager, paymentId);
    tick();
    const material = await invoices.createInvoice(manager, s.materialId, invoice({ number: "PL-77", baseCents: 10_000 }));
    await invoices.deleteInvoice(manager, material.invoiceId);
    tick();
    const gone = await createTestProject(tenant.id, { ref: "VTH-26-002", address: "Paseo de Pereda 3" });
    await projectsService.deleteProject(admin, gone.id);

    const { items, nextCursor, projects: obras } = await svc.listDeleted(admin);
    expect(nextCursor).toBeNull();
    expect(items).toEqual<DeletedItem[]>([
      {
        kind: "project",
        id: gone.id,
        label: "VTH-26-002",
        detail: "Paseo de Pereda 3",
        day: null,
        amountCents: null,
        projectId: gone.id,
        projectRef: "VTH-26-002",
        deletedAt: "2026-10-19T10:08:00.000Z",
        deletedBy: { id: admin.userId, name: "Ana Admin" },
        restorable: true,
        parent: null,
      },
      // 100 € + 21 % VAT.
      { kind: "invoice", id: material.invoiceId, label: "PL-77", detail: "Piedra de Liébana S.L.", day: "2026-09-22", amountCents: 12_100, deletedAt: "2026-10-19T10:07:00.000Z", deletedBy: byLaura, ...obra },
      { kind: "payment", id: paymentId, label: "MSN-2026/112", detail: "Montajes Steel Norte S.L.", day: "2026-10-15", amountCents: 20_000, deletedAt: "2026-10-19T10:06:00.000Z", deletedBy: byLaura, ...obra },
      { kind: "order_document", id: orderDocument.documentId, label: "Contrato firmado", detail: "PED-001 · Estructura Steel Frame", day: null, amountCents: null, deletedAt: "2026-10-19T10:05:00.000Z", deletedBy: byLaura, ...obra },
      { kind: "assignment", id: assignment!.id, label: "Montajes Steel Norte S.L.", detail: null, day: null, amountCents: null, deletedAt: "2026-10-19T10:04:00.000Z", deletedBy: byLaura, ...obra },
      { kind: "issue_file", id: fileId, label: "correo-proveedor.pdf", detail: "INC-001", day: null, amountCents: null, deletedAt: "2026-10-19T10:03:00.000Z", deletedBy: byLaura, ...obra },
      { kind: "photo", id: bare.id, label: "2026-10-09", detail: null, day: "2026-10-09", amountCents: null, deletedAt: "2026-10-19T10:02:00.000Z", deletedBy: byLaura, ...obra },
      { kind: "photo", id: photo.id, label: "Fachada sur", detail: null, day: "2026-10-08", amountCents: null, deletedAt: "2026-10-19T10:01:00.000Z", deletedBy: byLaura, ...obra },
      { kind: "document", id: documentId, label: "Contrato de obra", detail: null, day: null, amountCents: null, deletedAt: "2026-10-19T10:00:00.000Z", deletedBy: byLaura, ...obra },
    ]);
    // Where a file is stored is nobody's business.
    expect(JSON.stringify(items)).not.toContain("tenants/");
    // The obras to filter by: those with deleted records, a deleted one among them.
    expect(obras).toEqual([
      { id: project.id, ref: "VTH-26-001", deleted: false },
      { id: gone.id, ref: "VTH-26-002", deleted: true },
    ]);
  });

  it("names the deleter by their email without a name, and nobody once their account is gone", async () => {
    const { tenant, admin, project } = await base();
    const nameless = await createTestUser(tenant.id, { role: "manager", name: undefined, email: "obra@example.com" });
    const byNameless = await createTestDocument(tenant.id, project.id, { title: "A", deletedAt: new Date("2026-10-01T08:00:00Z"), deletedById: nameless.id });
    const byNobody = await createTestDocument(tenant.id, project.id, { title: "B", deletedAt: new Date("2026-10-02T08:00:00Z"), deletedById: null });

    const items = await list(admin);
    expect(items.find((i) => i.id === byNameless.id)!.deletedBy).toEqual({ id: nameless.id, name: "obra@example.com" });
    expect(items.find((i) => i.id === byNobody.id)!.deletedBy).toBeNull();
  });

  it("filters by kind and by obra, and pages by deletion (keyset), ties included", async () => {
    const { tenant, admin, project } = await base();
    const other = await createTestProject(tenant.id, { ref: "VTH-26-009" });
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 8, minute));
    const docs = [];
    // Five documents, the middle three deleted at the very same instant.
    for (const minute of [1, 2, 2, 2, 3]) {
      docs.push(await createTestDocument(tenant.id, project.id, { title: `Doc ${docs.length}`, deletedAt: at(minute), deletedById: admin.userId }));
    }
    const photo = await createTestPhoto(tenant.id, other.id, { deletedAt: at(10), deletedById: admin.userId });
    await createTestDocument(tenant.id, project.id, { title: "Vivo" });

    expect((await list(admin)).map((i) => i.id)).toHaveLength(6);
    expect((await list(admin, { kind: "photo" })).map((i) => i.id)).toEqual([photo.id]);
    expect((await list(admin, { kind: "project" })).map((i) => i.id)).toEqual([]);
    expect((await list(admin, { projectId: other.id })).map((i) => i.id)).toEqual([photo.id]);
    expect(await list(admin, { projectId: project.id, kind: "photo" })).toEqual([]);
    expect(await list(admin, { projectId: "nope" })).toEqual([]);

    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const page = await svc.listDeleted(admin, { limit: 2, ...(cursor ? { cursor } : {}) });
      expect(page.items.length).toBeLessThanOrEqual(2);
      // The obras come with the first page only.
      expect(page.projects === undefined).toBe(pages > 0);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(6);
    expect(new Set(seen)).toEqual(new Set([photo.id, ...docs.map((d) => d.id)]));
    expect(seen[0]).toBe(photo.id);
    expect(seen[1]).toBe(docs[4]!.id);
    expect(seen[5]).toBe(docs[0]!.id);
    // A filter keeps to its own pages.
    const first = await svc.listDeleted(admin, { kind: "document", limit: 4 });
    const rest = await svc.listDeleted(admin, { kind: "document", limit: 4, cursor: first.nextCursor });
    expect([...first.items, ...rest.items].map((i) => i.id).sort()).toEqual(docs.map((d) => d.id).sort());
    expect(rest.nextCursor).toBeNull();

    for (const bad of [{ kind: "budget" }, { limit: 0 }, { limit: "many" }, { cursor: "x" }, { cursor: "2026-13-41T10:00:00.000000_x" }, { cursor: "2026-02-30T10:00:00.000000_x" }, { projectId: 7 }]) {
      await expect(svc.listDeleted(admin, bad)).rejects.toMatchObject({ code: "invalid_input", status: 400 });
    }
    expect((await svc.listDeleted(admin, { limit: 5_000 })).items).toHaveLength(6);
  });

  it("sizes a page as every list does: 50 unless asked, never more than 200", async () => {
    const { tenant, admin, project } = await base();
    // More deleted documents than the largest page, each deleted a second after the last.
    const total = MAX_PAGE_SIZE + 5;
    await db.execute(sql`
      insert into project_documents (id, tenant_id, project_id, title, category, pathname, size_bytes, deleted_at, deleted_by_id)
      select 'doc-' || n, ${tenant.id}, ${project.id}, 'Documento ' || n, 'other', 'test/doc-' || n || '.pdf', 1,
        now() - make_interval(secs => ${total} - n), ${admin.userId}
      from generate_series(1, ${total}) n`);

    const byDefault = await svc.listDeleted(admin);
    expect(byDefault.items).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(byDefault.nextCursor).not.toBeNull();

    // A huge limit is cut to the cap, not refused; the cursor goes on from there to the end.
    const largest = await svc.listDeleted(admin, { limit: 5_000 });
    expect(largest.items).toHaveLength(MAX_PAGE_SIZE);
    expect(largest.items[0]).toMatchObject({ kind: "document", label: `Documento ${total}` });
    const rest = await svc.listDeleted(admin, { limit: "5000", cursor: largest.nextCursor });
    expect(rest.items.map((i) => i.label)).toEqual(["Documento 5", "Documento 4", "Documento 3", "Documento 2", "Documento 1"]);
    expect(rest.nextCursor).toBeNull();
    expect([DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE]).toEqual([50, 200]);
  });

  it("is for admins only, and never shows another tenant's records", async () => {
    const { tenant, admin, manager, project } = await base();
    const viewer: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "viewer" })).id, role: "viewer" };
    const doc = await createTestDocument(tenant.id, project.id);
    await documentsService.deleteDocument(admin, project.id, doc.id);
    await projectsService.deleteProject(admin, (await createTestProject(tenant.id)).id);

    for (const ctx of [manager, viewer]) {
      await expect(svc.listDeleted(ctx)).rejects.toMatchObject({ code: "forbidden", status: 403 });
      await expect(svc.restoreDeleted(ctx, "document", doc.id)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    }

    const elsewhere = await base();
    expect(await svc.listDeleted(elsewhere.admin)).toEqual({ items: [], nextCursor: null, projects: [] });
    expect(await list(elsewhere.admin, { projectId: project.id })).toEqual([]);
    await expect(svc.restoreDeleted(elsewhere.admin, "document", doc.id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    // Still deleted where it belongs.
    expect(await list(admin)).toHaveLength(2);
  });

  it("lists what hangs from a deleted obra only if it was deleted itself, and then it waits for its obra", async () => {
    const { tenant, admin, project } = await base();
    const kept = await createTestDocument(tenant.id, project.id, { title: "Sigue" });
    const removed = await createTestDocument(tenant.id, project.id, { title: "Borrado" });
    await documentsService.deleteDocument(admin, project.id, removed.id);
    tick();
    await projectsService.deleteProject(admin, project.id);

    const items = await list(admin);
    expect(items.map((i) => [i.kind, i.id])).toEqual([
      ["project", project.id],
      ["document", removed.id],
    ]);
    expect(items[1]).toMatchObject({ restorable: "parent_deleted", parent: { kind: "project", label: "VTH-26-001" } });
    expect(items[0]).toMatchObject({ restorable: true, parent: null });
    await expect(svc.restoreDeleted(admin, "document", removed.id)).rejects.toMatchObject({ code: "parent_deleted", status: 409 });

    // The obra back: its documents are reachable again, and the deleted one can now come back too.
    await svc.restoreDeleted(admin, "project", project.id);
    expect((await documentsService.listDocuments(admin, project.id)).map((d) => d.id)).toEqual([kept.id]);
    expect(await list(admin)).toMatchObject([{ id: removed.id, restorable: true, parent: null }]);
    await svc.restoreDeleted(admin, "document", removed.id);
    expect((await documentsService.listDocuments(admin, project.id)).map((d) => d.id).sort()).toEqual([kept.id, removed.id].sort());
    expect(await list(admin)).toEqual([]);
  });

  it("says beforehand when a ref or an invoice number has been used again, and which invoice a payment or credit note waits for", async () => {
    const s = await withPurchasing(await base());
    const { tenant, admin, manager } = s;
    const old = await createTestProject(tenant.id, { ref: "VTH-26-050" });
    await projectsService.deleteProject(admin, old.id);
    await createTestProject(tenant.id, { ref: "VTH-26-050" });

    const invoiceId = await addInvoice(s);
    const { paymentId } = await invoices.createPayment(manager, invoiceId, { amountCents: 100, paidOn: "2026-10-15" });
    const credit = await invoices.createInvoice(manager, s.subId, { kind: "credit_note", number: "R-1", issuedOn: "2026-10-01", rectifiesId: invoiceId, baseCents: -1_000 });
    await invoices.deletePayment(manager, paymentId);
    await invoices.deleteInvoice(manager, credit.invoiceId);
    await invoices.deleteInvoice(manager, invoiceId);
    const again = await addInvoice(s);

    expect(await find(admin, "project", old.id)).toMatchObject({ restorable: "ref_taken", parent: null });
    expect(await find(admin, "payment", paymentId)).toMatchObject({ restorable: "parent_deleted", parent: { kind: "invoice", label: "MSN-2026/112" } });
    expect(await find(admin, "invoice", credit.invoiceId)).toMatchObject({ restorable: "parent_deleted", parent: { kind: "invoice", label: "MSN-2026/112" }, amountCents: -1_000 });
    expect(await find(admin, "invoice", invoiceId)).toMatchObject({ restorable: "duplicate_number", parent: null });

    // The number free again, the invoice can come back, and then what hangs from it.
    await invoices.deleteInvoice(manager, again);
    expect(await find(admin, "invoice", invoiceId)).toMatchObject({ restorable: true });
    await svc.restoreDeleted(admin, "invoice", invoiceId);
    expect(await find(admin, "payment", paymentId)).toMatchObject({ restorable: true, parent: null });
    expect(await find(admin, "invoice", credit.invoiceId)).toMatchObject({ restorable: true, parent: null });
  });
});

describe("restoreDeleted: a project", () => {
  it("brings it back as it was, for the portal and the client's app, and logs it", async () => {
    const { tenant, admin, client, project } = await base();
    const doc = await createTestDocument(tenant.id, project.id);
    await projectsService.deleteProject(admin, project.id);
    expect(await projectsService.getProject(admin, project.id)).toBeNull();
    const before = await counters(project.id);

    expect(await svc.restoreDeleted(admin, "project", project.id)).toEqual({ kind: "project", id: project.id, projectId: project.id });

    expect(await projectsService.getProject(admin, project.id)).toMatchObject({ ref: "VTH-26-001", client: { id: client.id } });
    expect((await projectsService.listProjects(admin)).map((p) => p.id)).toEqual([project.id]);
    expect((await documentsService.listClientDocuments(tenant.id, client.id)).map((d) => d.id)).toEqual([doc.id]);
    expect(await list(admin)).toEqual([]);
    // The client's open app reloads every part of it.
    const after = await counters(project.id);
    expect(after).toEqual({ project: before.project + 1, obra: before.obra + 1, photos: before.photos + 1, documents: before.documents + 1 });
    expect(sendPush).not.toHaveBeenCalled();
    expect(logged(warn, "deleted.restored")).toEqual([
      expect.objectContaining({ level: "warn", kind: "project", id: project.id, tenantId: tenant.id, userId: admin.userId }),
    ]);

    await expect(svc.restoreDeleted(admin, "project", project.id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(logged(warn, "deleted.restored")).toHaveLength(1);
  });

  it("refuses while its ref is taken by another project: one of them is renamed or deleted first", async () => {
    const { tenant, admin, project } = await base();
    await projectsService.deleteProject(admin, project.id);
    const { id: twin } = await projectsService.createProject(admin, { ref: "VTH-26-001", address: "Otra calle 2" });

    await expect(svc.restoreDeleted(admin, "project", project.id)).rejects.toMatchObject({ code: "ref_taken", status: 409 });
    expect(await projectsService.getProject(admin, project.id)).toBeNull();
    expect(logged(warn, "deleted.restored")).toEqual([]);

    await projectsService.deleteProject(admin, twin);
    await svc.restoreDeleted(admin, "project", project.id);
    expect(await projectsService.getProject(admin, project.id)).not.toBeNull();
    // And now the twin is the one that can't come back.
    await expect(svc.restoreDeleted(admin, "project", twin)).rejects.toMatchObject({ code: "ref_taken" });
    expect(await db.select({ id: projects.id }).from(projects).where(eq(projects.tenantId, tenant.id))).toHaveLength(2);
  });

  it("answers not_found for a project that isn't deleted, an id that isn't one, or a kind that isn't either", async () => {
    const { admin, project } = await base();
    await expect(svc.restoreDeleted(admin, "project", project.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.restoreDeleted(admin, "project", "nope")).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.restoreDeleted(admin, "budget", project.id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(svc.restoreDeleted(admin, undefined, project.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("restoreDeleted: a project's document or photo", () => {
  it("brings a document back for staff and the client, moves the app's documents and pushes nothing", async () => {
    const { tenant, admin, manager, client, project } = await base();
    const { documentId } = await documentsService.addDocument(manager, project.id, { title: "Contrato de obra", category: "contract", file: pdf() });
    await documentsService.deleteDocument(manager, project.id, documentId);
    vi.mocked(sendPush).mockClear();
    const before = await counters(project.id);

    expect(await svc.restoreDeleted(admin, "document", documentId)).toEqual({ kind: "document", id: documentId, projectId: project.id });

    expect((await documentsService.listDocuments(admin, project.id)).map((d) => d.id)).toEqual([documentId]);
    expect((await documentsService.listClientDocuments(tenant.id, client.id)).map((d) => d.id)).toEqual([documentId]);
    await expect(documentsService.openDocument(admin, project.id, documentId)).resolves.toBeDefined();
    const [row] = await db.select().from(projectDocuments).where(eq(projectDocuments.id, documentId));
    expect(row).toMatchObject({ deletedAt: null, deletedById: null, title: "Contrato de obra" });
    expect(await counters(project.id)).toEqual({ ...before, documents: before.documents + 1 });
    // The client was told when it was uploaded: once only.
    expect(sendPush).not.toHaveBeenCalled();
    expect(await list(admin)).toEqual([]);
    expect(logged(warn, "deleted.restored")).toEqual([
      expect.objectContaining({ kind: "document", id: documentId, tenantId: tenant.id, userId: admin.userId }),
    ]);
    await expect(svc.restoreDeleted(admin, "document", documentId)).rejects.toMatchObject({ code: "not_found" });
  });

  it("brings a photo back the same way: the app's photos move, no push", async () => {
    const { tenant, admin, manager, client, project } = await base();
    const photo = await createTestPhoto(tenant.id, project.id, { caption: "Fachada sur" });
    await photosService.deletePhoto(manager, project.id, photo.id);
    const before = await counters(project.id);

    expect(await svc.restoreDeleted(admin, "photo", photo.id)).toEqual({ kind: "photo", id: photo.id, projectId: project.id });

    expect((await photosService.listPhotos(admin, project.id)).map((p) => p.id)).toEqual([photo.id]);
    expect((await photosService.listClientPhotos(tenant.id, client.id)).map((p) => p.id)).toEqual([photo.id]);
    expect(await counters(project.id)).toEqual({ ...before, photos: before.photos + 1 });
    expect(sendPush).not.toHaveBeenCalled();
    expect(await list(admin)).toEqual([]);
    expect(logged(warn, "deleted.restored")).toEqual([expect.objectContaining({ kind: "photo", id: photo.id, userId: admin.userId })]);
    await expect(svc.restoreDeleted(admin, "photo", photo.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses a document or a photo of a deleted obra, and one that isn't deleted, and keeps the kinds apart", async () => {
    const { tenant, admin, project } = await base();
    const live = await createTestDocument(tenant.id, project.id);
    const doc = await createTestDocument(tenant.id, project.id);
    const photo = await createTestPhoto(tenant.id, project.id);
    await documentsService.deleteDocument(admin, project.id, doc.id);
    await photosService.deletePhoto(admin, project.id, photo.id);

    await expect(svc.restoreDeleted(admin, "document", live.id)).rejects.toMatchObject({ code: "not_found" });
    // A photo's id is no document.
    await expect(svc.restoreDeleted(admin, "document", photo.id)).rejects.toMatchObject({ code: "not_found" });

    await projectsService.deleteProject(admin, project.id);
    const before = await counters(project.id);
    await expect(svc.restoreDeleted(admin, "document", doc.id)).rejects.toMatchObject({ code: "parent_deleted", status: 409 });
    await expect(svc.restoreDeleted(admin, "photo", photo.id)).rejects.toMatchObject({ code: "parent_deleted", status: 409 });
    expect(await counters(project.id)).toEqual(before);
    expect(logged(warn, "deleted.restored")).toEqual([]);
  });
});

describe("restoreDeleted: an incident's file", () => {
  it("puts the file back on its incident and logs it; not while the obra is deleted", async () => {
    const s = await withPurchasing(await base());
    const { tenant, admin, manager, project } = s;
    const { issueId } = await constructionService.createIssue(manager, project.id, issue());
    const { fileId } = await constructionService.addIssueFile(manager, project.id, issueId, { file: pdf("correo.pdf") });
    await constructionService.deleteIssueFile(manager, project.id, issueId, fileId);
    const filesOf = async () => (await constructionService.listIssues(admin, project.id))[0]!.files.map((f) => f.id);
    expect(await filesOf()).toEqual([]);

    await projectsService.deleteProject(admin, project.id);
    await expect(svc.restoreDeleted(admin, "issue_file", fileId)).rejects.toMatchObject({ code: "parent_deleted" });
    await svc.restoreDeleted(admin, "project", project.id);
    warn.mockClear();

    expect(await svc.restoreDeleted(admin, "issue_file", fileId)).toEqual({ kind: "issue_file", id: fileId, projectId: project.id });
    expect(await filesOf()).toEqual([fileId]);
    await expect(constructionService.openIssueFile(admin, project.id, issueId, fileId)).resolves.toMatchObject({ filename: "correo.pdf" });
    expect(await list(admin)).toEqual([]);
    expect(logged(warn, "deleted.restored")).toEqual([
      expect.objectContaining({ kind: "issue_file", id: fileId, tenantId: tenant.id, userId: admin.userId }),
    ]);
    await expect(svc.restoreDeleted(admin, "issue_file", fileId)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("restoreDeleted: a company's assignment to an obra", () => {
  const assigned = async (s: Purchasing) =>
    (await subcontractorsService.getSubcontractor(s.admin, s.subcontractorId)).assignments.map((a) => [a.projectId, a.chapterCodes]);
  const assignmentId = async () => (await db.select({ id: subcontractorAssignments.id }).from(subcontractorAssignments))[0]!.id;

  it("puts the company back on the obra as it was, with an entry in its history", async () => {
    const s = await withPurchasing(await base());
    const { admin, manager, project } = s;
    await subcontractorsService.assignToProject(admin, s.subcontractorId, project.id, { chapterCodes: ["03", "01"], plannedStart: "2026-07-01" });
    await subcontractorsService.removeAssignment(manager, s.subcontractorId, project.id);
    expect(await assigned(s)).toEqual([]);
    const id = await assignmentId();

    expect(await svc.restoreDeleted(admin, "assignment", id)).toEqual({ kind: "assignment", id, projectId: project.id });

    expect(await assigned(s)).toEqual([[project.id, ["01", "03"]]]);
    expect(await list(admin)).toEqual([]);
    const [entry] = await db.select().from(subcontractorAudit).where(eq(subcontractorAudit.action, "assignment_restored"));
    expect(entry).toMatchObject({
      subcontractorId: s.subcontractorId,
      userId: admin.userId,
      detail: { projectId: project.id, projectRef: "VTH-26-001" },
    });
    const { history } = await subcontractorsService.getSubcontractor(admin, s.subcontractorId);
    expect(history[0]).toMatchObject({ action: "assignment_restored", userName: "Ana Admin" });
    // Its history is the trace: no log line.
    expect(logged(warn, "deleted.restored")).toEqual([]);
    await expect(svc.restoreDeleted(admin, "assignment", id)).rejects.toMatchObject({ code: "not_found" });
    expect(await db.select().from(subcontractorAudit).where(eq(subcontractorAudit.action, "assignment_restored"))).toHaveLength(1);
  });

  it("has nothing to restore once the company was assigned again: the same row is live", async () => {
    const s = await withPurchasing(await base());
    const { admin, project } = s;
    await subcontractorsService.assignToProject(admin, s.subcontractorId, project.id, { chapterCodes: ["03"] });
    await subcontractorsService.removeAssignment(admin, s.subcontractorId, project.id);
    const id = await assignmentId();
    await subcontractorsService.assignToProject(admin, s.subcontractorId, project.id, { chapterCodes: ["02"] });

    expect(await list(admin)).toEqual([]);
    await expect(svc.restoreDeleted(admin, "assignment", id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(await assigned(s)).toEqual([[project.id, ["02"]]]);
  });

  it("refuses while the obra is deleted, and for a company that became a material supplier", async () => {
    const s = await withPurchasing(await base());
    const { tenant, admin, project } = s;
    const { id: other } = await subcontractorsService.createSubcontractor(admin, company({ legalName: "Áridos del Besaya S.L.", taxId: "B39777719" }));
    for (const subcontractorId of [s.subcontractorId, other]) {
      await subcontractorsService.assignToProject(admin, subcontractorId, project.id, { chapterCodes: ["03"] });
      await subcontractorsService.removeAssignment(admin, subcontractorId, project.id);
    }
    const idOf = async (subcontractorId: string) =>
      (await db.select().from(subcontractorAssignments).where(eq(subcontractorAssignments.subcontractorId, subcontractorId)))[0]!.id;

    // No obras, no workers, no subcontracts: it may become a supplier of material only.
    await subcontractorsService.updateSubcontractor(admin, other, { suppliesOnly: true });
    await expect(svc.restoreDeleted(admin, "assignment", await idOf(other))).rejects.toMatchObject({ code: "supplies_only", status: 409 });

    await projectsService.deleteProject(admin, project.id);
    expect(await find(admin, "assignment", await idOf(s.subcontractorId))).toMatchObject({
      label: "Montajes Steel Norte S.L.",
      restorable: "parent_deleted",
      parent: { kind: "project", label: "VTH-26-001" },
    });
    await expect(svc.restoreDeleted(admin, "assignment", await idOf(s.subcontractorId))).rejects.toMatchObject({ code: "parent_deleted" });
    expect(await db.select().from(subcontractorAudit).where(and(eq(subcontractorAudit.tenantId, tenant.id), eq(subcontractorAudit.action, "assignment_restored")))).toEqual([]);
  });
});

describe("restoreDeleted: an order's document", () => {
  it("puts the document back on its order with all its versions, in the order's history", async () => {
    const s = await withPurchasing(await base());
    const { admin, manager, project } = s;
    const { documentId } = await purchaseDocumentsService.addOrderDocument(manager, s.subId, { title: "Contrato firmado", file: pdf() });
    await purchaseDocumentsService.addOrderDocumentVersion(manager, s.subId, documentId, { file: pdf("v2.pdf"), note: "Firmado por ambas partes" });
    await purchaseDocumentsService.deleteOrderDocument(manager, s.subId, documentId);
    expect((await purchasingService.getPurchase(admin, s.subId)).documents).toEqual([]);

    await projectsService.deleteProject(admin, project.id);
    await expect(svc.restoreDeleted(admin, "order_document", documentId)).rejects.toMatchObject({ code: "parent_deleted", status: 409 });
    await svc.restoreDeleted(admin, "project", project.id);
    warn.mockClear();

    expect(await svc.restoreDeleted(admin, "order_document", documentId)).toEqual({ kind: "order_document", id: documentId, projectId: project.id });

    const order = await purchasingService.getPurchase(admin, s.subId);
    expect(order.documents).toMatchObject([{ id: documentId, title: "Contrato firmado", versions: [{ version: 2 }, { version: 1 }] }]);
    expect(order.events[0]).toMatchObject({ action: "document_restored", by: "Ana Admin", detail: { documentId, title: "Contrato firmado", versions: 2 } });
    await expect(purchaseDocumentsService.openOrderDocument(admin, s.subId, documentId)).resolves.toMatchObject({ filename: "v2.pdf" });
    expect(await list(admin)).toEqual([]);
    expect(logged(warn, "deleted.restored")).toEqual([]);
    await expect(svc.restoreDeleted(admin, "order_document", documentId)).rejects.toMatchObject({ code: "not_found" });
    expect(await events(s.subId, "document_restored")).toHaveLength(1);
  });
});

describe("restoreDeleted: a supplier's invoice", () => {
  it("puts the order's, the obra's and the supplier's figures back exactly as they were", async () => {
    const s = await withPurchasing(await base());
    const { admin, manager } = s;
    const invoiceId = await addInvoice(s);
    const material = await invoices.createInvoice(manager, s.materialId, invoice({ number: "PL-77", baseCents: 60_000 }));
    await invoices.createPayment(manager, material.invoiceId, { amountCents: 30_000, paidOn: "2026-10-15" });
    const before = await figures(s);
    expect(before.sub.invoicing.invoicedCents).toBe(49_000);

    await invoices.deleteInvoice(manager, invoiceId);
    const without = await figures(s);
    expect(without.sub.invoicing.invoicedCents).toBe(0);
    expect(without).not.toEqual(before);
    await expect(invoices.getInvoice(admin, invoiceId)).rejects.toMatchObject({ code: "not_found" });

    expect(await svc.restoreDeleted(admin, "invoice", invoiceId)).toEqual({ kind: "invoice", id: invoiceId, projectId: s.project.id });

    expect(await figures(s)).toEqual(before);
    const restored = await invoices.getInvoice(admin, invoiceId);
    expect(restored).toMatchObject({ number: "MSN-2026/112", baseCents: 49_000, outstandingCents: 46_550, state: "pending", createdBy: "Laura Pérez" });
    // In its order's history, and its own.
    expect(restored.events[0]).toMatchObject({ action: "invoice_restored", by: "Ana Admin", detail: { invoiceId, number: "MSN-2026/112", kind: "invoice" } });
    expect(await events(s.subId, "invoice_restored")).toHaveLength(1);
    expect(await list(admin)).toEqual([]);
    expect(logged(warn, "deleted.restored")).toEqual([]);
    const [row] = await db.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, invoiceId));
    expect(row).toMatchObject({ deletedAt: null, deletedById: null });

    await expect(svc.restoreDeleted(admin, "invoice", invoiceId)).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(await events(s.subId, "invoice_restored")).toHaveLength(1);
    // It can be paid again.
    await expect(invoices.createPayment(manager, invoiceId, { amountCents: 46_550 })).resolves.toBeDefined();
  });

  it("refuses while its number is used again by that supplier", async () => {
    const s = await withPurchasing(await base());
    const { admin, manager } = s;
    const invoiceId = await addInvoice(s);
    await invoices.deleteInvoice(manager, invoiceId);
    const again = await addInvoice(s, { baseCents: 10_000 });
    // Another supplier's same number is another invoice.
    await invoices.createInvoice(manager, s.materialId, invoice({ baseCents: 10_000 }));

    await expect(svc.restoreDeleted(admin, "invoice", invoiceId)).rejects.toMatchObject({ code: "duplicate_number", status: 409 });
    expect(await events(s.subId, "invoice_restored")).toEqual([]);

    await invoices.updateInvoice(manager, again, { number: "MSN-2026/113" });
    await svc.restoreDeleted(admin, "invoice", invoiceId);
    expect((await invoices.getInvoice(admin, invoiceId)).number).toBe("MSN-2026/112");
  });

  it("refuses while its obra is deleted", async () => {
    const s = await withPurchasing(await base());
    const invoiceId = await addInvoice(s);
    await invoices.deleteInvoice(s.manager, invoiceId);
    await projectsService.deleteProject(s.admin, s.project.id);

    expect(await find(s.admin, "invoice", invoiceId)).toMatchObject({ restorable: "parent_deleted", parent: { kind: "project", label: "VTH-26-001" } });
    await expect(svc.restoreDeleted(s.admin, "invoice", invoiceId)).rejects.toMatchObject({ code: "parent_deleted", status: 409 });

    await svc.restoreDeleted(s.admin, "project", s.project.id);
    await svc.restoreDeleted(s.admin, "invoice", invoiceId);
    expect((await invoices.listInvoices(s.admin)).invoices.map((i) => i.id)).toEqual([invoiceId]);
  });

  it("holds it to what a new invoice is held to: an order still placed, with its lines and its supplier", async () => {
    const s = await withPurchasing(await base());
    const { admin, manager } = s;

    // Its order cancelled meanwhile.
    const invoiceId = await addInvoice(s);
    await invoices.deleteInvoice(manager, invoiceId);
    await purchasingService.setPurchaseStatus(admin, s.subId, { status: "cancelled" });
    await expect(svc.restoreDeleted(admin, "invoice", invoiceId)).rejects.toMatchObject({ code: "invalid_state", status: 409 });

    // The line it was split across is no longer the order's.
    const material = await invoices.createInvoice(manager, s.materialId, invoice({ number: "PL-77", baseCents: 20_000, lines: [{ lineageId: s.lineage("02"), amountCents: 20_000 }] }));
    await invoices.deleteInvoice(manager, material.invoiceId);
    await purchasingService.updatePurchase(admin, s.materialId, { lines: [{ lineageId: s.lineage("01"), amountCents: 95_000 }] });
    await expect(svc.restoreDeleted(admin, "invoice", material.invoiceId)).rejects.toMatchObject({ code: "unknown_line", status: 400 });

    // The order went to another supplier.
    await purchasingService.updatePurchase(admin, s.materialId, {
      lines: [
        { lineageId: s.lineage("01"), amountCents: 95_000 },
        { lineageId: s.lineage("02"), amountCents: 50_000 },
      ],
    });
    const { id: otherSupplier } = await subcontractorsService.createSubcontractor(admin, company({ legalName: "Áridos del Besaya S.L.", taxId: "B39777719", suppliesOnly: true }));
    await purchasingService.updatePurchase(admin, s.materialId, { subcontractorId: otherSupplier });
    await expect(svc.restoreDeleted(admin, "invoice", material.invoiceId)).rejects.toMatchObject({ code: "invalid_state" });

    // Nothing came back, nothing was logged as restored.
    expect(await db.select().from(purchaseInvoices).where(eq(purchaseInvoices.tenantId, s.tenant.id))).toMatchObject([
      { deletedAt: expect.any(Date) },
      { deletedAt: expect.any(Date) },
    ]);
    expect(await db.select().from(purchaseOrderEvents).where(eq(purchaseOrderEvents.action, "invoice_restored"))).toEqual([]);
  });

  it("asks for a milestone once its order has a payment schedule", async () => {
    const s = await withPurchasing(await base());
    const { admin, manager } = s;
    const invoiceId = await addInvoice(s);
    await invoices.deleteInvoice(manager, invoiceId);
    await invoices.setOrderMilestones(manager, s.subId, {
      milestones: [
        { concept: "Inicio de fabricación", amountCents: 49_000 },
        { concept: "Fin de montaje", amountCents: 49_000 },
      ],
    });
    // As a new invoice without a milestone would be answered.
    await expect(invoices.createInvoice(manager, s.subId, invoice({ number: "X" }))).rejects.toMatchObject({ code: "missing_fields" });
    await expect(svc.restoreDeleted(admin, "invoice", invoiceId)).rejects.toMatchObject({ code: "missing_fields", status: 400 });

    // The schedule dropped: it fits again. And one deleted on a milestone that is still there comes back on it.
    await invoices.setOrderMilestones(manager, s.subId, { milestones: [] });
    await svc.restoreDeleted(admin, "invoice", invoiceId);
    await invoices.deleteInvoice(manager, invoiceId);
    await invoices.setOrderMilestones(manager, s.subId, {
      milestones: [
        { concept: "Inicio de fabricación", amountCents: 49_000 },
        { concept: "Fin de montaje", amountCents: 49_000 },
      ],
    });
    const { milestones } = await purchasingService.getPurchase(admin, s.subId);
    const onMilestone = await addInvoice(s, { number: "MSN-2026/200", milestoneId: milestones[0]!.id });
    await invoices.deleteInvoice(manager, onMilestone);
    await svc.restoreDeleted(admin, "invoice", onMilestone);
    expect((await purchasingService.getPurchase(admin, s.subId)).milestones[0]).toMatchObject({ invoicedCents: 49_000, invoices: [{ id: onMilestone }] });
  });

  it("brings a credit note back only with its invoice there, and only while it still fits in it", async () => {
    const s = await withPurchasing(await base());
    const { admin, manager } = s;
    const invoiceId = await addInvoice(s);
    const credit = (number: string, baseCents: number) =>
      invoices.createInvoice(manager, s.subId, { kind: "credit_note", number, issuedOn: "2026-10-01", rectifiesId: invoiceId, baseCents });
    const first = await credit("R-1", -10_000);
    const before = await figures(s);
    await invoices.deleteInvoice(manager, first.invoiceId);

    // Another credit note takes most of the invoice meanwhile: 490 − 450 leaves 40, not 100.
    const second = await credit("R-2", -45_000);
    await expect(svc.restoreDeleted(admin, "invoice", first.invoiceId)).rejects.toMatchObject({ code: "exceeds_amount", status: 409 });

    await invoices.deleteInvoice(manager, second.invoiceId);
    await invoices.deleteInvoice(manager, invoiceId);
    await expect(svc.restoreDeleted(admin, "invoice", first.invoiceId)).rejects.toMatchObject({ code: "parent_deleted", status: 409 });

    await svc.restoreDeleted(admin, "invoice", invoiceId);
    await svc.restoreDeleted(admin, "invoice", first.invoiceId);
    expect(await figures(s)).toEqual(before);
    expect(await invoices.getInvoice(admin, invoiceId)).toMatchObject({ creditNotes: [{ id: first.invoiceId, baseCents: -10_000 }] });
    expect((await events(s.subId, "invoice_restored")).map((e) => e.detail.kind).sort()).toEqual(["credit_note", "invoice"]);
  });
});

describe("restoreDeleted: a supplier's payment", () => {
  it("puts the invoice's, the order's and the supplier's figures back exactly as they were", async () => {
    const s = await withPurchasing(await base());
    const { admin, manager } = s;
    const invoiceId = await addInvoice(s);
    await invoices.createPayment(manager, invoiceId, { amountCents: 6_550, paidOn: "2026-10-10" });
    const { paymentId } = await invoices.createPayment(manager, invoiceId, { amountCents: 20_000, paidOn: "2026-10-15", reference: "TR-1", file: pdf("justificante.pdf") });
    const before = await figures(s);
    expect(await invoices.getInvoice(admin, invoiceId)).toMatchObject({ paidCents: 26_550, outstandingCents: 20_000, state: "partial" });

    await invoices.deletePayment(manager, paymentId);
    expect(await invoices.getInvoice(admin, invoiceId)).toMatchObject({ paidCents: 6_550, outstandingCents: 40_000 });
    expect(await figures(s)).not.toEqual(before);

    expect(await svc.restoreDeleted(admin, "payment", paymentId)).toEqual({ kind: "payment", id: paymentId, projectId: s.project.id });

    expect(await figures(s)).toEqual(before);
    const restored = await invoices.getInvoice(admin, invoiceId);
    expect(restored).toMatchObject({ paidCents: 26_550, outstandingCents: 20_000, state: "partial" });
    expect(restored.payments.map((p) => p.id)).toContain(paymentId);
    expect(restored.events[0]).toMatchObject({
      action: "payment_restored",
      by: "Ana Admin",
      detail: { invoiceId, number: "MSN-2026/112", paymentId, amountCents: 20_000, paidOn: "2026-10-15" },
    });
    // Its proof was never gone.
    await expect(invoices.openPaymentFile(admin, paymentId)).resolves.toMatchObject({ filename: "justificante.pdf" });
    expect((await invoices.listPayments(admin)).payments.map((p) => p.id)).toContain(paymentId);
    expect(await list(admin)).toEqual([]);
    expect(logged(warn, "deleted.restored")).toEqual([]);
    const [row] = await db.select().from(purchasePayments).where(eq(purchasePayments.id, paymentId));
    expect(row).toMatchObject({ deletedAt: null, deletedById: null, createdById: manager.userId });

    await expect(svc.restoreDeleted(admin, "payment", paymentId)).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(await events(s.subId, "payment_restored")).toHaveLength(1);
  });

  it("refuses a payment that no longer fits in what its invoice is owed", async () => {
    const s = await withPurchasing(await base());
    const { admin, manager } = s;
    const invoiceId = await addInvoice(s);
    const { paymentId } = await invoices.createPayment(manager, invoiceId, { amountCents: 30_000, paidOn: "2026-10-15" });
    await invoices.deletePayment(manager, paymentId);
    // Paid again, in full and its retention released: 490 € in all.
    const again = await invoices.createPayment(manager, invoiceId, { amountCents: 49_000, paidOn: "2026-10-16" });

    await expect(svc.restoreDeleted(admin, "payment", paymentId)).rejects.toMatchObject({ code: "exceeds_amount", status: 409 });
    expect(await invoices.getInvoice(admin, invoiceId)).toMatchObject({ paidCents: 49_000 });
    expect(await events(s.subId, "payment_restored")).toEqual([]);

    // Room for it again: the 300 € fit in the 490 €.
    await invoices.deletePayment(manager, again.paymentId);
    await invoices.createPayment(manager, invoiceId, { amountCents: 19_000, paidOn: "2026-10-16" });
    await svc.restoreDeleted(admin, "payment", paymentId);
    expect(await invoices.getInvoice(admin, invoiceId)).toMatchObject({ paidCents: 49_000, payableLeftCents: 0 });
    // And the one deleted since doesn't fit any more.
    await expect(svc.restoreDeleted(admin, "payment", again.paymentId)).rejects.toMatchObject({ code: "exceeds_amount" });
  });

  it("refuses while its invoice or its obra is deleted, and a payment dated before its invoice", async () => {
    const s = await withPurchasing(await base());
    const { admin, manager } = s;
    const invoiceId = await addInvoice(s);
    const { paymentId } = await invoices.createPayment(manager, invoiceId, { amountCents: 30_000, paidOn: "2026-09-25" });
    await invoices.deletePayment(manager, paymentId);

    // The invoice turned out to be of October: a payment of September can't be its.
    await invoices.updateInvoice(manager, invoiceId, { issuedOn: "2026-10-01", dueOn: "2026-10-31" });
    await expect(svc.restoreDeleted(admin, "payment", paymentId)).rejects.toMatchObject({ code: "invalid_date", status: 400 });
    await invoices.updateInvoice(manager, invoiceId, { issuedOn: "2026-09-22" });

    await invoices.deleteInvoice(manager, invoiceId);
    await expect(svc.restoreDeleted(admin, "payment", paymentId)).rejects.toMatchObject({ code: "parent_deleted", status: 409 });
    await svc.restoreDeleted(admin, "invoice", invoiceId);

    await projectsService.deleteProject(admin, s.project.id);
    expect(await find(admin, "payment", paymentId)).toMatchObject({ restorable: "parent_deleted", parent: { kind: "project", label: "VTH-26-001" } });
    await expect(svc.restoreDeleted(admin, "payment", paymentId)).rejects.toMatchObject({ code: "parent_deleted" });
    await svc.restoreDeleted(admin, "project", s.project.id);

    await svc.restoreDeleted(admin, "payment", paymentId);
    expect(await invoices.getInvoice(admin, invoiceId)).toMatchObject({ paidCents: 30_000 });
  });
});
