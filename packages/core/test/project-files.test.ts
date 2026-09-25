import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { removeFiles, storeFiles } from "../src/project-files";
import * as storage from "../src/storage";
import { files } from "../src/testing";

vi.mock("../src/storage", () => import("../src/testing"));

const newFiles = [
  { pathname: "a.jpg", body: new Blob(["a"]), contentType: "image/jpeg" },
  { pathname: "a.thumb.webp", body: new Blob(["t"]), contentType: "image/webp" },
];

beforeEach(() => files.clear());
afterEach(() => vi.restoreAllMocks());

describe("storeFiles", () => {
  it("stores every file, then records the row", async () => {
    const insertRow = vi.fn(async () => {
      expect([...files.keys()]).toEqual(["a.jpg", "a.thumb.webp"]);
    });

    await storeFiles(newFiles, insertRow);

    expect(insertRow).toHaveBeenCalled();
    expect(files.size).toBe(2);
  });

  it("removes every file again when the row can't be saved", async () => {
    await expect(
      storeFiles(newFiles, () => Promise.reject(new Error("insert failed"))),
    ).rejects.toThrow("insert failed");

    expect(files.size).toBe(0);
  });

  it("waits for a slower upload before cleaning up after a failed one", async () => {
    let finishSlow!: () => void;
    vi.spyOn(storage, "putFile").mockImplementation(async (pathname, body) => {
      if (pathname === "a.thumb.webp") throw new Error("upload failed");
      await new Promise<void>((resolve) => (finishSlow = resolve));
      files.set(pathname, body);
    });
    const insertRow = vi.fn();

    const stored = storeFiles(newFiles, insertRow);
    await new Promise((resolve) => setTimeout(resolve, 0));
    finishSlow();

    await expect(stored).rejects.toThrow("upload failed");
    expect(insertRow).not.toHaveBeenCalled();
    expect(files.size).toBe(0);
  });
});

describe("removeFiles", () => {
  it("deletes the files before the row", async () => {
    await storeFiles(newFiles, async () => {});
    const deleteRow = vi.fn(async () => expect(files.size).toBe(0));

    await removeFiles(["a.jpg", "a.thumb.webp"], deleteRow);

    expect(deleteRow).toHaveBeenCalled();
  });
});
