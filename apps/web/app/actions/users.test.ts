import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { signInAs } from "../../test/session";
import { setLanguageAction } from "./users";

vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

const languageOf = async (id: string) =>
  (await db.query.users.findFirst({ where: eq(users.id, id) }))?.language;

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
});

describe("setLanguageAction", () => {
  it("saves the caller's language and re-renders the portal", async () => {
    const tenant = await createTestTenant();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    signInAs({ tenantId: tenant.id, userId: viewer.id, role: "viewer" });

    expect(await setLanguageAction("en")).toEqual({});
    expect(await languageOf(viewer.id)).toBe("en");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("refuses a language the portal doesn't have", async () => {
    const tenant = await createTestTenant();
    const admin = await createTestUser(tenant.id, { role: "admin" });
    signInAs({ tenantId: tenant.id, userId: admin.id, role: "admin" });

    expect(await setLanguageAction("fr" as "en")).toEqual({ error: "invalid_language" });
    expect(await languageOf(admin.id)).toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("needs a signed-in staff member", async () => {
    signInAs(null);
    await expect(setLanguageAction("en")).rejects.toThrow("Unauthorized");
  });
});
