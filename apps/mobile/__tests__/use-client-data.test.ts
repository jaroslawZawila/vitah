import { act, renderHook, waitFor } from "@testing-library/react-native";
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

  it("signs out when the session is rejected", async () => {
    load.mockResolvedValue({ ok: false, error: "unauthorized" });
    renderHook(() => useClientData(load));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });
});
