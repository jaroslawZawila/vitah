import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { signInAs } from "../../test/session";
import { createClientAction, getClients, setClientPasswordAction } from "./clients";

// The service itself is covered in packages/core; these tests cover the
// adapter: session → core → `{ error }` / revalidation.

vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const clientForm = () =>
  form({
    firstName: "Ana",
    surnames: "García",
    email: "ana@example.com",
    password: "client-pass",
    dateOfBirth: "",
    address: "",
    phone: "",
  });

async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  signInAs({ tenantId: tenant.id, userId: admin.id, role: "admin" });
  return { tenant, admin };
}

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
});

describe("client actions", () => {
  it("creates a client and revalidates the clients page", async () => {
    await setup();

    expect(await createClientAction(null, clientForm())).toEqual({ success: true });
    expect((await getClients()).map((c) => c.email)).toEqual(["ana@example.com"]);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/clients");
  });

  it("returns core errors as form state without revalidating", async () => {
    await setup();
    const data = clientForm();
    data.set("password", "short");

    expect(await createClientAction(null, data)).toEqual({ error: "password_too_short" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sets a client's password", async () => {
    await setup();
    await createClientAction(null, clientForm());
    const [client] = await getClients();

    expect(
      await setClientPasswordAction(client!.id, null, form({ password: "brand-new-pass" })),
    ).toEqual({ success: true });
  });

  it("returns forbidden for non-admins and lists nothing", async () => {
    const { tenant, admin } = await setup();
    signInAs({ tenantId: tenant.id, userId: admin.id, role: "manager" });

    expect(await createClientAction(null, clientForm())).toEqual({ error: "forbidden" });
    expect(await getClients()).toEqual([]);
  });

  it("rejects anonymous requests", async () => {
    signInAs(null);

    await expect(createClientAction(null, clientForm())).rejects.toThrow("Unauthorized");
  });
});
