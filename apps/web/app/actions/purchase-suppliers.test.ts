import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { subcontractorsService } from "@repo/core";
import { signInAs } from "../../test/session";
import { getSupplierPurchasing, getSuppliers } from "./purchase-suppliers";

// The service is covered in packages/core; these tests cover the adapter.

vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);

async function setup(role: "admin" | "viewer" = "viewer") {
  const tenant = await createTestTenant();
  const admin = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" as const };
  const { id } = await subcontractorsService.createSubcontractor(admin, {
    kind: "company",
    legalName: "Piedra de Liébana S.L.",
    taxId: "B39654322",
    address: "Barrio La Serna 7",
    postalCode: "39570",
    city: "Potes",
    suppliesOnly: true,
  });
  const user = await createTestUser(tenant.id, { role });
  signInAs({ tenantId: tenant.id, userId: user.id, role });
  return { id };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("supplier actions", () => {
  it("read the suppliers and one supplier's purchasing, for any staff member", async () => {
    const { id } = await setup();
    expect((await getSuppliers())!.suppliers.map((s) => s.id)).toEqual([id]);
    expect(await getSupplierPurchasing(id)).toMatchObject({ supplier: { id, orders: 0 }, orders: [], invoices: [], payments: [] });
  });

  it("show nothing of another tenant, or signed out", async () => {
    const { id } = await setup();
    await setup();
    expect(await getSupplierPurchasing(id)).toBeNull();
    signInAs(null);
    expect(await getSuppliers()).toBeNull();
  });
});
