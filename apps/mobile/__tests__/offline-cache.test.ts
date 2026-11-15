import {
  clearOffline,
  OFFLINE_FORMAT,
  offlineSession,
  pruneOffline,
  readOffline,
  writeOffline,
} from "../lib/offline-cache";
import { disk } from "../test-utils/expo-file-system";

jest.mock("expo-file-system", () => require("../test-utils/expo-file-system"));

const key = { userId: "u1", name: "obra", projectId: "p1" };
const now = new Date("2026-11-15T09:30:00.000Z");

beforeEach(() => disk.clear());

describe("offline cache", () => {
  it("keeps an answer in the cache directory and reads it back with its date", async () => {
    writeOffline(key, { progressPct: 40 }, offlineSession(), now);

    expect([...disk.keys()].every((uri) => uri.startsWith("file:///cache-dir/"))).toBe(true);
    expect(await readOffline(key)).toEqual({ data: { progressPct: 40 }, savedAt: now.toISOString() });
  });

  it("never shows one home's answer under another, or one client's under another", async () => {
    writeOffline(key, "p1 data", offlineSession());

    expect(await readOffline({ ...key, projectId: "p2" })).toBeNull();
    expect(await readOffline({ ...key, userId: "u2" })).toBeNull();
    expect(await readOffline({ ...key, name: "photos" })).toBeNull();
    expect(await readOffline({ ...key, projectId: null })).toBeNull();
    expect((await readOffline(key))?.data).toBe("p1 data");
  });

  it("ignores and deletes an answer in another format or a broken file", async () => {
    writeOffline(key, "x", offlineSession());
    const [uri] = [...disk.keys()];
    disk.set(uri!, JSON.stringify({ v: OFFLINE_FORMAT + 1, savedAt: now.toISOString(), data: "x" }));
    expect(await readOffline(key)).toBeNull();
    expect(disk.size).toBe(0);

    writeOffline(key, "x", offlineSession());
    disk.set(uri!, "{not json");
    expect(await readOffline(key)).toBeNull();
    expect(disk.size).toBe(0);

    disk.set(uri!, JSON.stringify({ v: OFFLINE_FORMAT, data: "no date" }));
    expect(await readOffline(key)).toBeNull();
    expect(disk.size).toBe(0);
  });

  it("drops the homes that are no longer the client's, and only theirs", async () => {
    writeOffline({ ...key, projectId: "p1" }, "a", offlineSession());
    writeOffline({ ...key, projectId: "p2" }, "b", offlineSession());
    writeOffline({ ...key, name: "projects", projectId: undefined }, "list", offlineSession());
    writeOffline({ ...key, userId: "u2", projectId: "p2" }, "other client", offlineSession());

    pruneOffline("u1", ["p1"]);

    expect((await readOffline(key))?.data).toBe("a");
    expect(await readOffline({ ...key, projectId: "p2" })).toBeNull();
    expect((await readOffline({ ...key, name: "projects", projectId: null }))?.data).toBe("list");
    expect((await readOffline({ ...key, userId: "u2", projectId: "p2" }))?.data).toBe("other client");

    pruneOffline("u1", []);
    expect(await readOffline(key)).toBeNull();
  });

  it("is wiped on sign-out, and a load still running then writes nothing", async () => {
    const started = offlineSession();
    writeOffline(key, "a", started);

    await clearOffline();
    expect(disk.size).toBe(0);

    writeOffline(key, "late answer of the previous client", started);
    expect(disk.size).toBe(0);
    await expect(clearOffline()).resolves.toBeUndefined();
  });

  it("does not throw when the file system fails", async () => {
    const { File } = jest.requireMock("expo-file-system");
    const write = jest.spyOn(File.prototype, "write").mockImplementation(() => {
      throw new Error("disk full");
    });

    expect(() => writeOffline(key, "a", offlineSession())).not.toThrow();
    write.mockRestore();
  });
});
