import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { clientAccountService } from "@repo/core";
import { apiRequest, routeParams, staffToken } from "../../../../../../test/api";
import { GET as list } from "../../route";
import { DELETE } from "./route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

beforeEach(resetDatabase);

/** A tenant whose client asked in the app for their account to be deleted. */
async function setup() {
  const tenant = await createTestTenant();
  const { token } = await staffToken(tenant.id, "admin");
  const client = await createTestUser(tenant.id, { role: "client" });
  const { deletionRequestedAt } = await clientAccountService.requestDeletion(tenant.id, client.id);
  return { tenant, token, client, deletionRequestedAt };
}

const clear = (token: string | null, id: string) => DELETE(apiRequest(token, { method: "DELETE" }), routeParams({ id }));

describe("the deletion request on /api/v1/clients", () => {
  it("is listed with its date, and cleared by an admin", async () => {
    const { token, client, deletionRequestedAt } = await setup();

    expect(await (await list(apiRequest(token))).json()).toEqual([
      expect.objectContaining({ id: client.id, active: true, deletionRequestedAt }),
    ]);

    const cleared = await clear(token, client.id);
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ id: client.id });
    expect(await (await list(apiRequest(token))).json()).toEqual([
      expect.objectContaining({ id: client.id, active: true, deletionRequestedAt: null }),
    ]);
  });

  it("is admins' only, and the tenant's own", async () => {
    const { tenant, client } = await setup();
    const { token: manager } = await staffToken(tenant.id, "manager");
    const { token: stranger } = await staffToken((await createTestTenant()).id, "admin");

    expect((await clear(manager, client.id)).status).toBe(403);
    expect((await clear(stranger, client.id)).status).toBe(404);
    expect((await clear(null, client.id)).status).toBe(401);
  });
});
