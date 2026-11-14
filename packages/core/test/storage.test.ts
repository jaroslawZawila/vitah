import { beforeEach, describe, expect, it, vi } from "vitest";
import { del, get, list, put } from "@vercel/blob";
import { putFile, readFile } from "../src/storage";

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
});
