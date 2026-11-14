import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreError, type Ctx } from "@repo/core";
import { NOT_FOUND, TO_FORBIDDEN, TO_LOGIN } from "../../test/navigation";
import { signInAs } from "../../test/session";
import { mutate, mutateDashboard, read } from "./run";

// What every page read and every server action goes through: who is asking,
// and what each way of failing means for the page.

vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

const manager: Ctx = { tenantId: "t1", userId: "u1", role: "manager" };
const failing = (code: string, status: number) => async () => {
  throw new CoreError(code, status);
};

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
  signInAs(manager);
});

describe("read", () => {
  it("gives the data and whether the caller may edit", async () => {
    expect(await read(async (ctx) => ({ tenant: ctx.tenantId }))).toEqual({ data: { tenant: "t1" }, canManage: true });

    signInAs({ ...manager, role: "viewer" });
    expect(await read(async () => "x")).toEqual({ data: "x", canManage: false });
  });

  it("sends a visitor without a session to the login page, without reading", async () => {
    signInAs(null);
    const fn = vi.fn();

    await expect(read(fn)).rejects.toEqual(TO_LOGIN);
    expect(fn).not.toHaveBeenCalled();
  });

  it.each(["not_found", "project_not_found", "worker_not_found"])("shows \"No encontrado\" for a record that isn't there (%s)", async (code) => {
    await expect(read(failing(code, 404))).rejects.toEqual(NOT_FOUND);
  });

  it("shows \"No tienes permiso\" for what the caller's role may not read", async () => {
    await expect(read(failing("forbidden", 403))).rejects.toEqual(TO_FORBIDDEN);
  });

  it("leaves any other expected failure to the page, as null", async () => {
    expect(await read(failing("invalid_input", 400))).toBeNull();
    expect(await read(failing("invalid_state", 409))).toBeNull();
  });

  it("with `optional`, nothing there is null too: a state the page handles", async () => {
    expect(await read(failing("not_found", 404), { optional: true })).toBeNull();
    // Still no way around a missing session or permission.
    await expect(read(failing("forbidden", 403), { optional: true })).rejects.toEqual(TO_FORBIDDEN);
    signInAs(null);
    await expect(read(failing("not_found", 404), { optional: true })).rejects.toEqual(TO_LOGIN);
  });

  it("lets an unexpected error through, for the error page and the log", async () => {
    await expect(
      read(async () => {
        throw new TypeError("database down");
      }),
    ).rejects.toThrow(TypeError);
  });
});

describe("mutate", () => {
  it("runs the write and refreshes the project's tabs", async () => {
    const after = vi.fn();

    expect(await mutate("p1", async () => "done", after)).toEqual({ success: true });

    expect(after).toHaveBeenCalledWith(manager);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/projects/p1", "layout");
  });

  it("returns an expected failure as the form's state", async () => {
    const after = vi.fn();

    expect(await mutate("p1", failing("forbidden", 403), after)).toEqual({ error: "forbidden" });
    expect(await mutate("p1", failing("not_found", 404), after)).toEqual({ error: "not_found" });

    expect(after).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sends a caller whose session ended to the login page, instead of crashing", async () => {
    signInAs(null);
    const fn = vi.fn();

    await expect(mutate("p1", fn)).rejects.toEqual(TO_LOGIN);
    await expect(mutateDashboard("p1", fn)).rejects.toEqual(TO_LOGIN);

    expect(fn).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("lets an unexpected error through", async () => {
    await expect(
      mutate("p1", async () => {
        throw new TypeError("database down");
      }),
    ).rejects.toThrow(TypeError);
  });
});
