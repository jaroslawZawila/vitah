import { act, renderHook } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import type { MobileChanges } from "@repo/core/contract";
import { api, type Result } from "../lib/api";
import { changedAreas, POLL_MS, useLiveUpdates } from "../lib/live-updates";

const mockSignOut = jest.fn(async () => {});
jest.mock("../lib/auth", () => ({ useAuth: () => ({ token: "tok", signOut: mockSignOut }) }));
jest.mock("../lib/api", () => ({ api: { getChanges: jest.fn() } }));

const mockReload = {
  project: jest.fn(async () => {}),
  obra: jest.fn(async () => {}),
  photos: jest.fn(async () => {}),
  documents: jest.fn(async () => {}),
};
jest.mock("../lib/use-project", () => ({ useProject: () => ({ reload: mockReload.project }) }));
jest.mock("../lib/use-obra", () => ({ useObra: () => ({ reload: mockReload.obra }) }));
jest.mock("../lib/use-photos", () => ({ usePhotos: () => ({ reload: mockReload.photos }) }));
jest.mock("../lib/documents", () => ({ useDocuments: () => ({ reload: mockReload.documents }) }));

const getChanges = jest.mocked(api.getChanges);

const base: MobileChanges = { projectId: "p1", project: 0, obra: 3, photos: 1, documents: 2 };

/** The server's next answer. */
function serve(changes: MobileChanges | null) {
  getChanges.mockResolvedValue({ ok: true, data: { changes } });
}

const reloaded = () =>
  Object.entries(mockReload)
    .filter(([, fn]) => fn.mock.calls.length > 0)
    .map(([area]) => area);

/** Lets the timers run and the replies land. */
async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

let appStateListener: ((status: AppStateStatus) => void) | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  serve(base);
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  });
});

afterEach(() => jest.useRealTimers());

describe("changedAreas", () => {
  it("lists the counters that moved", () => {
    expect(changedAreas(base, { ...base, obra: 4, documents: 3 })).toEqual(["obra", "documents"]);
    expect(changedAreas(base, base)).toEqual([]);
    expect(changedAreas(null, null)).toEqual([]);
  });

  it("reloads everything when the project changes", () => {
    const all = ["project", "obra", "photos", "documents"];
    expect(changedAreas(base, { ...base, projectId: "p2" })).toEqual(all);
    expect(changedAreas(base, null)).toEqual(all);
    expect(changedAreas(null, base)).toEqual(all);
  });
});

describe("useLiveUpdates", () => {
  it("takes the first reading as the baseline", async () => {
    renderHook(useLiveUpdates);
    await advance(0);

    expect(getChanges).toHaveBeenCalledWith("tok");
    expect(reloaded()).toEqual([]);
  });

  it("reloads only what changed, on the next poll", async () => {
    renderHook(useLiveUpdates);
    await advance(0);

    serve({ ...base, photos: 2, obra: 4 });
    await advance(POLL_MS);

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(reloaded()).toEqual(["obra", "photos"]);
  });

  it("reloads nothing while nothing changes", async () => {
    renderHook(useLiveUpdates);
    await advance(POLL_MS * 3);

    expect(getChanges).toHaveBeenCalledTimes(4);
    expect(reloaded()).toEqual([]);
  });

  it("reloads everything when the client gets a project", async () => {
    serve(null);
    renderHook(useLiveUpdates);
    await advance(0);

    serve(base);
    await advance(POLL_MS);

    expect(reloaded()).toEqual(["project", "obra", "photos", "documents"]);
  });

  it("keeps the baseline when a poll fails", async () => {
    renderHook(useLiveUpdates);
    await advance(0);

    getChanges.mockResolvedValueOnce({ ok: false, error: "network_error" } as Result<never>);
    await advance(POLL_MS);
    expect(reloaded()).toEqual([]);

    serve({ ...base, documents: 3 });
    await advance(POLL_MS);
    expect(reloaded()).toEqual(["documents"]);
  });

  it("stops polling in the background and catches up in the foreground", async () => {
    renderHook(useLiveUpdates);
    await advance(0);

    act(() => appStateListener?.("background"));
    serve({ ...base, obra: 9 });
    await advance(POLL_MS * 3);
    expect(getChanges).toHaveBeenCalledTimes(1);

    // Compared with the reading from before, in case the change raced the providers' own reload.
    act(() => appStateListener?.("active"));
    await advance(0);
    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(reloaded()).toEqual(["obra"]);
  });

  it("reloads nothing on return when nothing changed", async () => {
    renderHook(useLiveUpdates);
    await advance(0);

    act(() => appStateListener?.("background"));
    act(() => appStateListener?.("active"));
    await advance(0);

    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(reloaded()).toEqual([]);
  });

  it("signs out when the session is rejected", async () => {
    getChanges.mockResolvedValue({ ok: false, error: "unauthorized" } as Result<never>);
    renderHook(useLiveUpdates);
    await advance(0);

    expect(mockSignOut).toHaveBeenCalled();
  });

  it("doesn't start a poll while one is still waiting for its reply", async () => {
    getChanges.mockImplementationOnce(() => new Promise(() => {}));
    renderHook(useLiveUpdates);
    await advance(POLL_MS * 2);

    expect(getChanges).toHaveBeenCalledTimes(1);
  });

  it("drops a reply that arrives after the app went to the background", async () => {
    let answer: (result: Result<{ changes: MobileChanges | null }>) => void = () => {};
    renderHook(useLiveUpdates);
    await advance(0);

    getChanges.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    await advance(POLL_MS);
    act(() => appStateListener?.("background"));
    await act(async () => answer({ ok: true, data: { changes: { ...base, photos: 5 } } }));

    expect(reloaded()).toEqual([]);
  });

  it("stops polling when unmounted", async () => {
    const { unmount } = renderHook(useLiveUpdates);
    await advance(0);

    unmount();
    await advance(POLL_MS * 2);

    expect(getChanges).toHaveBeenCalledTimes(1);
  });
});
