import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { db, eq, purchaseDocumentChecks } from "@repo/db";
import { purchasingService, subcontractorsService } from "@repo/core";
import { files } from "@repo/core/testing";
import { seedObra } from "@repo/core/seed";
import { signInAs } from "../../test/session";
import { dismissCheckAction, recheckDocumentAction } from "./purchase-checks";
import { addOrderDocumentAction, getPurchase } from "./purchasing";

// The review itself is covered in packages/core (Claude mocked); these tests
// cover the adapters: an upload queues its PDF, staff ask again or mark as seen.

vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

async function setup(role: "manager" | "viewer" = "manager") {
  const tenant = await createTestTenant();
  const admin = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" as const };
  const project = await createTestProject(tenant.id);
  await seedObra(admin, project.id);
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
  const lineageId = form.chapters.find((c) => c.code === "06")!.lines[0]!.lineageId;
  const { orderId } = await purchasingService.createPurchase(admin, project.id, { kind: "material", subcontractorId: supplierId, description: "Piedra", lines: [{ lineageId, amountCents: 1_000 }] });
  const user = await createTestUser(tenant.id, { role });
  signInAs({ tenantId: tenant.id, userId: user.id, role });
  return { project, orderId };
}

const upload = (title = "Pedido") => {
  const form = new FormData();
  form.set("title", title);
  form.set("file", new File(["%PDF-1.7 pedido"], "pedido.pdf", { type: "application/pdf" }));
  return form;
};

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("document review actions", () => {
  it("queue an uploaded PDF for review as the upload answers", async () => {
    const s = await setup();
    expect(await addOrderDocumentAction(s.project.id, s.orderId, upload())).toEqual({ success: true });
    expect((await getPurchase(s.orderId))!.order.checks).toMatchObject([{ status: "pending", label: "Pedido · v1" }]);
  });

  it("ask again, or mark as seen a settled review, and return core's errors", async () => {
    const s = await setup();
    await addOrderDocumentAction(s.project.id, s.orderId, upload());
    const [check] = (await getPurchase(s.orderId))!.order.checks;
    // Still waiting: asking again just runs it; nothing to mark as seen yet.
    expect(await recheckDocumentAction(check!.id)).toEqual({ success: true });
    expect(await dismissCheckAction(check!.id)).toEqual({ error: "invalid_state" });
    await db.update(purchaseDocumentChecks).set({ status: "done", findings: [{ kind: "unreadable", detail: { es: "En blanco", en: "Blank" } }] }).where(eq(purchaseDocumentChecks.id, check!.id));
    expect(await dismissCheckAction(check!.id)).toEqual({ success: true });
    expect(await recheckDocumentAction(check!.id)).toEqual({ success: true });
    expect((await getPurchase(s.orderId))!.order.checks[0]).toMatchObject({ status: "pending", findings: [], dismissedAt: null });
    expect(await recheckDocumentAction("nope")).toEqual({ error: "not_found" });
  });

  it("let viewers only read", async () => {
    const s = await setup("viewer");
    expect(await addOrderDocumentAction(s.project.id, s.orderId, upload())).toEqual({ error: "forbidden" });
    expect(await recheckDocumentAction("any")).toEqual({ error: "forbidden" });
  });
});
