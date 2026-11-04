import { act, renderHook, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import type { Result } from "../lib/api";
import { useClientData } from "../lib/use-client-data";

const mockSignOut = jest.fn();
jest.mock("../lib/auth", () => ({ useAuth: () => ({ token: "tok", signOut: mockSignOut }) }));

const load = jest.fn<Promise<Result<string[]>>, [string]>();

beforeEach(() => jest.clearAllMocks());

describe("useClientData", () => {
  it("loads with the client's token", async () => {
    load.mockResolvedValue({ ok: true, data: ["a"] });
    const { result } = renderHook(() => useClientData(load));

    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toEqual(["a"]));
    expect(load).toHaveBeenCalledWith("tok");
  });

  it("keeps loaded data when a refresh fails, then retries", async () => {
    load.mockResolvedValueOnce({ ok: true, data: ["a"] });
    const { result } = renderHook(() => useClientData(load));
    await waitFor(() => expect(result.current.data).toEqual(["a"]));

    load.mockResolvedValueOnce({ ok: false, error: "network_error" });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current).toMatchObject({ data: ["a"], refreshing: false });

    load.mockResolvedValueOnce({ ok: true, data: ["a", "b"] });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.data).toEqual(["a", "b"]));
    expect(result.current.error).toBe(false);
  });

  it("loads again when the app returns to the foreground", async () => {
    const listeners: ((status: string) => void)[] = [];
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_type, listener) => {
        listeners.push(listener as (status: string) => void);
        return { remove: jest.fn() } as never;
      });
    load.mockResolvedValueOnce({ ok: true, data: ["a"] }).mockResolvedValueOnce({ ok: true, data: ["a", "b"] });
    const { result } = renderHook(() => useClientData(load));
    await waitFor(() => expect(result.current.data).toEqual(["a"]));

    act(() => listeners.forEach((listener) => listener("active")));

    await waitFor(() => expect(result.current.data).toEqual(["a", "b"]));
  });

  it("signs out when the session is rejected", async () => {
    load.mockResolvedValue({ ok: false, error: "unauthorized" });
    renderHook(() => useClientData(load));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });
});

describe("useClientData reload", () => {
  it("loads again without showing a refresh", async () => {
    load.mockResolvedValueOnce({ ok: true, data: ["a"] });
    const { result } = renderHook(() => useClientData(load));
    await waitFor(() => expect(result.current.data).toEqual(["a"]));

    let resolve: (value: Result<string[]>) => void = () => {};
    load.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    act(() => void result.current.reload());
    expect(result.current.refreshing).toBe(false);

    await act(async () => resolve({ ok: true, data: ["a", "b"] }));
    expect(result.current.data).toEqual(["a", "b"]);
  });

  it("keeps the newest answer when loads overlap", async () => {
    load.mockResolvedValueOnce({ ok: true, data: ["a"] });
    const { result } = renderHook(() => useClientData(load));
    await waitFor(() => expect(result.current.data).toEqual(["a"]));

    let slow: (value: Result<string[]>) => void = () => {};
    load.mockImplementationOnce(() => new Promise((r) => (slow = r)));
    load.mockResolvedValueOnce({ ok: true, data: ["a", "b"] });
    act(() => result.current.refresh());
    await act(async () => void (await result.current.reload()));
    expect(result.current.data).toEqual(["a", "b"]);

    await act(async () => slow({ ok: true, data: ["a"] }));
    expect(result.current).toMatchObject({ data: ["a", "b"], refreshing: false });
  });

  it("waits while there is nothing to load yet", async () => {
    const { result } = renderHook(() => useClientData(null));

    await act(async () => {});
    expect(result.current.data).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it("drops what the last fetch loaded when another one takes over", async () => {
    const other = jest.fn<Promise<Result<string[]>>, [string]>();
    load.mockResolvedValue({ ok: true, data: ["first home"] });
    let answer: (result: Result<string[]>) => void = () => {};
    other.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const { result, rerender } = renderHook(({ fetch }: { fetch: typeof load }) => useClientData(fetch), {
      initialProps: { fetch: load },
    });
    await waitFor(() => expect(result.current.data).toEqual(["first home"]));

    rerender({ fetch: other });
    expect(result.current.data).toBeUndefined();

    await act(async () => answer({ ok: true, data: ["second home"] }));
    expect(result.current.data).toEqual(["second home"]);
  });
});
