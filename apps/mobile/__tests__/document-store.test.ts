import type { MobileDocument } from "@repo/core/contract";
import { api } from "../lib/api";
import {
  clearDocuments,
  documentFile,
  markSeen,
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

    const { documents } = (await syncDocuments("tok")) as { documents: unknown };

    expect(listDocuments).toHaveBeenCalledWith("tok");
    expect(await documentFile("a").text()).toBe("pdf from https://api.test/api/mobile/documents/a");
    expect(documentFile("b").exists).toBe(true);
    expect(headers).toEqual([
      { Authorization: "Bearer tok" },
      { Authorization: "Bearer tok" },
    ]);
    const expected = [
      { ...doc("a"), downloaded: true, isNew: true },
      { ...doc("b"), downloaded: true, isNew: true },
    ];
    expect(documents).toEqual(expected);
    expect(await readDocuments()).toEqual(expected);
  });

  it("keeps existing files and deletes removed documents", async () => {
    serverHas(doc("a"), doc("b"));
    await syncDocuments("tok");
    const handler = jest.fn(() => "%PDF-");
    downloads.handler = handler;
    serverHas(doc("b"), doc("c"));

    await syncDocuments("tok");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(documentFile("a").exists).toBe(false);
    expect((await readDocuments()).map((d) => d.id)).toEqual(["b", "c"]);
  });

  it("lists a document whose download failed, and retries it next time", async () => {
    downloads.handler = () => {
      throw new Error("offline");
    };
    serverHas(doc("a"));

    await syncDocuments("tok");
    expect(await readDocuments()).toEqual([{ ...doc("a"), downloaded: false, isNew: true }]);

    downloads.handler = () => "%PDF-";
    await syncDocuments("tok");
    expect((await readDocuments())[0]?.downloaded).toBe(true);
  });

  it("keeps the local copies when the server can't be reached", async () => {
    serverHas(doc("a"));
    await syncDocuments("tok");
    listDocuments.mockResolvedValue({ ok: false, error: "network_error" });

    expect(await syncDocuments("tok")).toEqual({ error: "network_error" });
    expect(await readDocuments()).toEqual([{ ...doc("a"), downloaded: true, isNew: true }]);
  });
});

describe("markSeen", () => {
  it("clears the new flag, and forgets documents that were removed", async () => {
    serverHas(doc("a"), doc("b"));
    await syncDocuments("tok");

    await markSeen("a");
    expect((await readDocuments()).map((d) => d.isNew)).toEqual([false, true]);

    serverHas(doc("b"));
    await syncDocuments("tok");
    serverHas(doc("a"), doc("b"));
    await syncDocuments("tok");
    expect((await readDocuments()).map((d) => d.isNew)).toEqual([true, true]);
  });
});

describe("clearDocuments", () => {
  it("removes every file and the list", async () => {
    serverHas(doc("a"));
    await syncDocuments("tok");

    clearDocuments();

    expect(disk.size).toBe(0);
    expect(await readDocuments()).toEqual([]);
  });

  it("stops a sync that is still running for the signed-out client", async () => {
    serverHas(doc("a"), doc("b"));
    downloads.handler = (url) => {
      if (url.endsWith("/a")) clearDocuments(); // sign-out during the first download
      return "%PDF-";
    };

    expect(await syncDocuments("tok")).toEqual({ error: "signed_out" });

    expect(disk.size).toBe(0);
    expect(await readDocuments()).toEqual([]);
  });

  it("is a no-op when nothing was stored", () => {
    expect(() => clearDocuments()).not.toThrow();
  });
});

describe("readDocuments", () => {
  it("is empty before the first sync and survives a corrupt list", async () => {
    expect(await readDocuments()).toEqual([]);
    disk.set("file:///documents-dir/documents/manifest.json", "{not json");
    expect(await readDocuments()).toEqual([]);
  });
});
