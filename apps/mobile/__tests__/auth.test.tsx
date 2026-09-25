import { act, renderHook, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import type { ReactNode } from "react";
import { api } from "../lib/api";
import { AuthProvider, useAuth } from "../lib/auth";
import { clearDocuments } from "../lib/document-store";

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void store.delete(key)),
  };
});
jest.mock("../lib/api", () => ({ api: { signIn: jest.fn() } }));
jest.mock("../lib/document-store", () => ({ clearDocuments: jest.fn() }));

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const user = { id: "u", email: "ana@example.com", name: "Ana", role: "client" as const, tenantId: "t" };

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

beforeEach(() => {
  store.clear();
  jest.mocked(api.signIn).mockReset();
});

describe("AuthProvider", () => {
  it("starts signed out when nothing is stored", async () => {
    const { result } = renderHook(useAuth, { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.token).toBeNull();
  });

  it("restores a stored session", async () => {
    store.set("vitah_token", "stored-token");
    store.set("vitah_user", JSON.stringify(user));

    const { result } = renderHook(useAuth, { wrapper });

    await waitFor(() => expect(result.current.token).toBe("stored-token"));
    expect(result.current.user).toEqual(user);
  });

  it("stores the session after signing in", async () => {
    jest.mocked(api.signIn).mockResolvedValue({ ok: true, data: { token: "new-token", user } });
    const { result } = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: { error?: string } = {};
    await act(async () => {
      outcome = await result.current.signIn("ana@example.com", "pw");
    });

    expect(outcome).toEqual({});
    expect(result.current.token).toBe("new-token");
    expect(store.get("vitah_token")).toBe("new-token");
    expect(JSON.parse(store.get("vitah_user")!)).toEqual(user);
  });

  it("returns the error when sign-in fails", async () => {
    jest.mocked(api.signIn).mockResolvedValue({ ok: false, error: "invalid_credentials" });
    const { result } = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: { error?: string } = {};
    await act(async () => {
      outcome = await result.current.signIn("ana@example.com", "bad");
    });

    expect(outcome).toEqual({ error: "invalid_credentials" });
    expect(result.current.token).toBeNull();
    expect(store.has("vitah_token")).toBe(false);
  });

  it("clears the session on sign-out", async () => {
    store.set("vitah_token", "stored-token");
    store.set("vitah_user", JSON.stringify(user));
    const { result } = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(result.current.token).toBe("stored-token"));

    await act(() => result.current.signOut());

    expect(result.current.token).toBeNull();
    expect(store.size).toBe(0);
    expect(clearDocuments).toHaveBeenCalled();
  });
});
