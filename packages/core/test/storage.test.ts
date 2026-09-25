import { beforeEach, describe, expect, it, vi } from "vitest";
import { del, get, list, put } from "@vercel/blob";
import { deleteFolder, putFile, readFile } from "../src/storage";

vi.mock("@vercel/blob", () => ({ put: vi.fn(), get: vi.fn(), del: vi.fn(), list: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("storage", () => {
  it("stores files privately under the exact pathname", async () => {
    const body = new Blob(["%PDF-"]);

    await putFile("tenants/t/projects/p/d.pdf", body, "application/pdf");

    expect(put).toHaveBeenCalledWith("tenants/t/projects/p/d.pdf", body, {
      access: "private",
      contentType: "application/pdf",
      addRandomSuffix: false,
    });
  });

  it("reads private files, and null when missing", async () => {
    const stream = new Blob(["x"]).stream();
    vi.mocked(get).mockResolvedValueOnce({ statusCode: 200, stream } as never);
    vi.mocked(get).mockResolvedValueOnce(null);

    expect(await readFile("a.pdf")).toBe(stream);
    expect(await readFile("missing.pdf")).toBeNull();
    expect(get).toHaveBeenCalledWith("a.pdf", { access: "private" });
  });

  it("deletes every page of a folder", async () => {
    vi.mocked(list)
      .mockResolvedValueOnce({ blobs: [{ url: "u1" }], hasMore: true, cursor: "c" } as never)
      .mockResolvedValueOnce({ blobs: [{ url: "u2" }], hasMore: false } as never);

    await deleteFolder("tenants/t/projects/p/");

    expect(list).toHaveBeenNthCalledWith(1, { prefix: "tenants/t/projects/p/", cursor: undefined });
    expect(list).toHaveBeenNthCalledWith(2, { prefix: "tenants/t/projects/p/", cursor: "c" });
    expect(del).toHaveBeenCalledWith(["u1"]);
    expect(del).toHaveBeenCalledWith(["u2"]);
  });

  it("does nothing for an empty folder", async () => {
    vi.mocked(list).mockResolvedValueOnce({ blobs: [], hasMore: false } as never);

    await deleteFolder("tenants/t/projects/p/");

    expect(del).not.toHaveBeenCalled();
  });
});
