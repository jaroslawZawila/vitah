import type { MobileDocument } from "@repo/core/contract";
import { api } from "../lib/api";
import {
  clearDocuments,
  documentFile,
  markSeen,
  pruneDocuments,
  readDocuments,
  syncDocuments,
} from "../lib/document-store";
import { disk, downloads } from "../test-utils/expo-file-system";

jest.mock("expo-file-system", () => require("../test-utils/expo-file-system"));
jest.mock("../lib/api", () => ({
  api: {
    listDocuments: jest.fn(),
    documentUrl: (id: string) => `https://api.test/api/mobile/documents/${id}`,
  },
}));

const listDocuments = jest.mocked(api.listDocuments);

/** The home whose documents are synced. */
const P = "p1";

const doc = (id: string): MobileDocument => ({
  id,
  title: `Documento ${id}`,
  category: "contract",
  sizeBytes: 1024,
  uploadedAt: "2026-09-22T10:00:00.000Z",
});

function serverHas(...documents: MobileDocument[]) {
  listDocuments.mockResolvedValue({ ok: true, data: { documents } });
}

beforeEach(() => {
  disk.clear();
  listDocuments.mockReset();
  downloads.handler = () => "%PDF-";
});

describe("syncDocuments", () => {
  it("downloads every document with the client's token", async () => {
    const headers: unknown[] = [];
    downloads.handler = (url, h) => {
      headers.push(h);
      return `pdf from ${url}`;
    };
    serverHas(doc("a"), doc("b"));

    const { documents } = (await syncDocuments("tok", P)) as { documents: unknown };

    expect(listDocuments).toHaveBeenCalledWith("tok", P);
    expect(await documentFile(P, "a").text()).toBe("pdf from https://api.test/api/mobile/documents/a");
    expect(documentFile(P, "b").exists).toBe(true);
    expect(headers).toEqual([
      { Authorization: "Bearer tok" },
      { Authorization: "Bearer tok" },
    ]);
    const expected = [
      { ...doc("a"), downloaded: true, isNew: true },
      { ...doc("b"), downloaded: true, isNew: true },
    ];
    expect(documents).toEqual(expected);
    expect(await readDocuments(P)).toEqual(expected);
  });

  it("keeps existing files and deletes removed documents", async () => {
    serverHas(doc("a"), doc("b"));
    await syncDocuments("tok", P);
    const handler = jest.fn(() => "%PDF-");
    downloads.handler = handler;
    serverHas(doc("b"), doc("c"));

    await syncDocuments("tok", P);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(documentFile(P, "a").exists).toBe(false);
    expect((await readDocuments(P)).map((d) => d.id)).toEqual(["b", "c"]);
  });

  it("lists a document whose download failed, and retries it next time", async () => {
    downloads.handler = () => {
      throw new Error("offline");
    };
    serverHas(doc("a"));

    await syncDocuments("tok", P);
    expect(await readDocuments(P)).toEqual([{ ...doc("a"), downloaded: false, isNew: true }]);

    downloads.handler = () => "%PDF-";
    await syncDocuments("tok", P);
    expect((await readDocuments(P))[0]?.downloaded).toBe(true);
  });

  it("keeps the local copies when the server can't be reached", async () => {
    serverHas(doc("a"));
    await syncDocuments("tok", P);
    listDocuments.mockResolvedValue({ ok: false, error: "network_error" });

    expect(await syncDocuments("tok", P)).toEqual({ error: "network_error" });
    expect(await readDocuments(P)).toEqual([{ ...doc("a"), downloaded: true, isNew: true }]);
  });
});

describe("markSeen", () => {
  it("clears the new flag, and forgets documents that were removed", async () => {
    serverHas(doc("a"), doc("b"));
    await syncDocuments("tok", P);

    await markSeen(P, "a");
    expect((await readDocuments(P)).map((d) => d.isNew)).toEqual([false, true]);

    serverHas(doc("b"));
    await syncDocuments("tok", P);
    serverHas(doc("a"), doc("b"));
    await syncDocuments("tok", P);
    expect((await readDocuments(P)).map((d) => d.isNew)).toEqual([true, true]);
  });
});

describe("clearDocuments", () => {
  it("removes every file and the list", async () => {
    serverHas(doc("a"));
    await syncDocuments("tok", P);

    clearDocuments();

    expect(disk.size).toBe(0);
    expect(await readDocuments(P)).toEqual([]);
  });

  it("stops a sync that is still running for the signed-out client", async () => {
    serverHas(doc("a"), doc("b"));
    downloads.handler = (url) => {
      if (url.endsWith("/a")) clearDocuments(); // sign-out during the first download
      return "%PDF-";
    };

    expect(await syncDocuments("tok", P)).toEqual({ error: "signed_out" });

    expect(disk.size).toBe(0);
    expect(await readDocuments(P)).toEqual([]);
  });

  it("is a no-op when nothing was stored", () => {
    expect(() => clearDocuments()).not.toThrow();
  });
});

describe("several homes", () => {
  it("stops downloading once that home is no longer shown", async () => {
    serverHas(doc("a"), doc("b"));
    let shown = true;
    downloads.handler = () => {
      shown = false; // the client switched home during the first download
      return "%PDF-";
    };

    expect(await syncDocuments("tok", P, () => shown)).toEqual({ error: "stopped" });
    expect(documentFile(P, "a").exists).toBe(true);
    expect(documentFile(P, "b").exists).toBe(false);
  });

  it("keeps each home's copies apart", async () => {
    serverHas(doc("a"));
    await syncDocuments("tok", "p1");
    serverHas(doc("b"));
    await syncDocuments("tok", "p2");

    expect((await readDocuments("p1")).map((d) => d.id)).toEqual(["a"]);
    expect((await readDocuments("p2")).map((d) => d.id)).toEqual(["b"]);
    expect(documentFile("p1", "a").exists).toBe(true);
    expect(documentFile("p2", "a").exists).toBe(false);
  });

  it("prunes the copies of homes no longer the client's, and those kept before homes", async () => {
    serverHas(doc("a"));
    await syncDocuments("tok", "p1");
    await syncDocuments("tok", "p2");
    disk.set("file:///documents-dir/documents/manifest.json", "{}");
    disk.set("file:///documents-dir/documents/old.pdf", "%PDF-");

    pruneDocuments(["p2"]);

    expect([...disk.keys()].sort()).toEqual([
      "file:///documents-dir/documents/p2/a.pdf",
      "file:///documents-dir/documents/p2/manifest.json",
    ]);
  });

  it("prunes nothing before anything was stored", () => {
    expect(() => pruneDocuments([])).not.toThrow();
  });
});

describe("readDocuments", () => {
  it("is empty before the first sync and survives a corrupt list", async () => {
    expect(await readDocuments(P)).toEqual([]);
    disk.set("file:///documents-dir/documents/p1/manifest.json", "{not json");
    expect(await readDocuments(P)).toEqual([]);
  });
});
