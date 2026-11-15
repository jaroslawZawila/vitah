import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { warrantyService } from "@repo/core";
import { signInAs } from "../../test/session";
import { NOT_FOUND } from "../../test/navigation";
import { getProjectWarranty, getWarrantyClaim, updateClaimAction } from "./warranty";

// The service itself is covered in packages/core; these tests cover the
// adapter: session → core → `{ error }` / revalidation.

vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

/** A handed-over home whose client sent a claim, and a staff member signed in. */
async function setup(role: "admin" | "manager" | "viewer" = "manager") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, { clientUserId: client.id, obraStage: 8 });
  const { claimId } = await warrantyService.createClientClaim(tenant.id, client.id, project.id, {
    kind: "finishes",
    room: "living_room",
    description: "Grieta en el rodapié.",
  });
  signInAs({ tenantId: tenant.id, userId: user.id, role });
  return { tenant, project, claimId };
}

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
});

describe("warranty actions", () => {
  it("reads the project's claims and one claim, with whether the caller may handle them", async () => {
    const { project, claimId } = await setup();

    const list = await getProjectWarranty(project.id);
    expect(list).toMatchObject({ canManage: true, warranty: { handedOver: true, claims: [{ id: claimId, status: "received" }] } });
    expect(await getWarrantyClaim(project.id, claimId)).toMatchObject({ canManage: true, claim: { id: claimId, events: [{ action: "created" }] } });
  });

  it("answers a claim and refreshes the project's pages", async () => {
    const { project, claimId } = await setup();

    expect(await updateClaimAction(project.id, claimId, { status: "scheduled", visitOn: "2026-12-01", answer: "Iremos por la mañana." })).toEqual({
      success: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`, "layout");
    expect((await getWarrantyClaim(project.id, claimId))!.claim).toMatchObject({ status: "scheduled", visitOn: "2026-12-01" });
  });

  it("returns the error code of a change it refuses", async () => {
    const { project, claimId } = await setup();

    expect(await updateClaimAction(project.id, claimId, { status: "rejected" })).toEqual({ error: "reason_required" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("lets viewers read, not change", async () => {
    const { project, claimId } = await setup("viewer");

    expect((await getProjectWarranty(project.id))!.canManage).toBe(false);
    expect(await updateClaimAction(project.id, claimId, { status: "in_review" })).toEqual({ error: "forbidden" });
  });

  it("sends another tenant's claim to the not-found page", async () => {
    const { project, claimId } = await setup();
    const other = await createTestTenant();
    const stranger = await createTestUser(other.id, { role: "admin" });
    signInAs({ tenantId: other.id, userId: stranger.id, role: "admin" });

    await expect(getWarrantyClaim(project.id, claimId)).rejects.toEqual(NOT_FOUND);
    await expect(getProjectWarranty(project.id)).rejects.toEqual(NOT_FOUND);
  });
});
