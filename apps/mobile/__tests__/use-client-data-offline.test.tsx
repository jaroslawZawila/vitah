import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { Result } from "../lib/api";
import { clearOffline, offlineSession, readOffline, writeOffline } from "../lib/offline-cache";
import { useClientData } from "../lib/use-client-data";
import { disk } from "../test-utils/expo-file-system";

jest.mock("expo-file-system", () => require("../test-utils/expo-file-system"));

const mockSignOut = jest.fn();
let mockUser: { id: string } | undefined = { id: "u1" };
jest.mock("../lib/auth", () => ({
  useAuth: () => ({ token: "tok", user: mockUser, signOut: mockSignOut }),
}));

type Data = { n: number };
const load = jest.fn<Promise<Result<Data>>, [string]>();
const key = (projectId: string, userId = "u1") => ({ userId, name: "obra", projectId });
const options = (projectId: string) => ({ cache: { name: "obra", projectId } });

beforeEach(() => {
  jest.clearAllMocks();
  disk.clear();
  mockUser = { id: "u1" };
});

describe("useClientData with an offline copy", () => {
  it("shows the stored copy at once, then the fresh answer, which is stored in turn", async () => {
    writeOffline(key("p1"), { n: 1 }, offlineSession(), new Date("2026-11-14T08:00:00.000Z"));
    let answer: (r: Result<Data>) => void = () => {};
    load.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    const { result } = renderHook(() => useClientData(load, options("p1")));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    expect(result.current).toMatchObject({ updatedAt: "2026-11-14T08:00:00.000Z", error: false });
    expect(result.current.offline).toBeFalsy();

    await act(async () => answer({ ok: true, data: { n: 2 } }));
    expect(result.current.data).toEqual({ n: 2 });
    expect((await readOffline<Data>(key("p1")))?.data).toEqual({ n: 2 });
  });

  it("keeps showing the stored copy, flagged offline, while the network fails, and clears the flag when it answers", async () => {
    writeOffline(key("p1"), { n: 1 }, offlineSession(), new Date("2026-11-14T08:00:00.000Z"));
    load.mockResolvedValueOnce({ ok: false, error: "network_error" });

    const { result } = renderHook(() => useClientData(load, options("p1")));

    await waitFor(() => expect(result.current).toMatchObject({ data: { n: 1 }, error: true, offline: true }));
    expect(result.current.updatedAt).toBe("2026-11-14T08:00:00.000Z");

    load.mockResolvedValueOnce({ ok: true, data: { n: 3 } });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current).toMatchObject({ data: { n: 3 }, error: false, offline: false }));
    expect(result.current.updatedAt).not.toBe("2026-11-14T08:00:00.000Z");
  });

  it("flags a timeout as offline but a server error only as an error", async () => {
    writeOffline(key("p1"), { n: 1 }, offlineSession());
    load.mockResolvedValueOnce({ ok: false, error: "timeout" });
    const { result } = renderHook(() => useClientData(load, options("p1")));
    await waitFor(() => expect(result.current.offline).toBe(true));

    load.mockResolvedValueOnce({ ok: false, error: "server_error" });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current).toMatchObject({ error: true, offline: false, data: { n: 1 } }));
  });

  it("without a stored copy and without a network there is only the error", async () => {
    load.mockResolvedValue({ ok: false, error: "network_error" });
    const { result } = renderHook(() => useClientData(load, options("p1")));

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("never shows one home's copy under another, even while the other loads", async () => {
    writeOffline(key("p1"), { n: 1 }, offlineSession());
    writeOffline(key("p2"), { n: 2 }, offlineSession());
    const forP1 = jest.fn<Promise<Result<Data>>, [string]>().mockResolvedValue({ ok: false, error: "network_error" });
    const forP2 = jest.fn<Promise<Result<Data>>, [string]>().mockResolvedValue({ ok: false, error: "network_error" });

    const { result, rerender } = renderHook(
      ({ home }: { home: "p1" | "p2" }) =>
        useClientData(home === "p1" ? forP1 : forP2, options(home)),
      { initialProps: { home: "p1" } },
    );
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

    rerender({ home: "p2" });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
  });

  it("never shows another client's copy", async () => {
    writeOffline(key("p1", "u1"), { n: 1 }, offlineSession());
    mockUser = { id: "u2" };
    load.mockResolvedValue({ ok: false, error: "network_error" });

    const { result } = renderHook(() => useClientData(load, options("p1")));

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("a fresh answer that came before the stored read wins", async () => {
    writeOffline(key("p1"), { n: 1 }, offlineSession());
    load.mockResolvedValue({ ok: true, data: { n: 9 } });

    const { result } = renderHook(() => useClientData(load, options("p1")));

    await waitFor(() => expect(result.current.data).toEqual({ n: 9 }));
    await act(async () => {});
    expect(result.current.data).toEqual({ n: 9 });
  });

  it("ignores a copy in an older format and deletes it", async () => {
    writeOffline(key("p1"), { n: 1 }, offlineSession());
    const [uri] = [...disk.keys()];
    disk.set(uri!, JSON.stringify({ v: 0, savedAt: "2026-01-01T00:00:00.000Z", data: { n: 1 } }));
    load.mockResolvedValue({ ok: false, error: "network_error" });

    const { result } = renderHook(() => useClientData(load, options("p1")));

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(disk.has(uri!)).toBe(false);
  });

  it("stores nothing without the option, and nothing for an unknown client", async () => {
    load.mockResolvedValue({ ok: true, data: { n: 1 } });
    const plain = renderHook(() => useClientData(load));
    await waitFor(() => expect(plain.result.current.data).toEqual({ n: 1 }));
    expect(disk.size).toBe(0);

    mockUser = undefined;
    const anonymous = renderHook(() => useClientData(load, options("p1")));
    await waitFor(() => expect(anonymous.result.current.data).toEqual({ n: 1 }));
    expect(disk.size).toBe(0);
  });

  it("stores only the data shown, never the token", async () => {
    load.mockResolvedValue({ ok: true, data: { n: 1 } });
    const { result } = renderHook(() => useClientData(load, options("p1")));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

    expect([...disk.values()].join("")).not.toContain("tok");
  });

  it("does not store an answer once the client signed out meanwhile", async () => {
    let answer: (r: Result<Data>) => void = () => {};
    load.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderHook(() => useClientData(load, options("p1")));

    await clearOffline();
    await act(async () => answer({ ok: true, data: { n: 1 } }));

    expect(disk.size).toBe(0);
  });

  it("calls onFresh with server answers only, not the stored copy", async () => {
    writeOffline(key("p1"), { n: 1 }, offlineSession());
    const onFresh = jest.fn();
    load.mockResolvedValue({ ok: true, data: { n: 2 } });

    const { result } = renderHook(() => useClientData(load, { ...options("p1"), onFresh }));
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));

    expect(onFresh).toHaveBeenCalledTimes(1);
    expect(onFresh).toHaveBeenCalledWith({ n: 2 });
  });

  it("signs out on unauthorized without showing the stored copy as an answer", async () => {
    load.mockResolvedValue({ ok: false, error: "unauthorized" });
    renderHook(() => useClientData(load, options("p1")));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });
});
