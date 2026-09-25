import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import { api } from "../lib/api";
import { AuthProvider, useAuth } from "../lib/auth";
import { Image } from "expo-image";
import { clearDocuments } from "../lib/document-store";
import { secureStore } from "../test-utils/secure-store";

jest.mock("../lib/api", () => ({ api: { signIn: jest.fn(), getProject: jest.fn() } }));
jest.mock("../lib/document-store", () => ({ clearDocuments: jest.fn() }));
jest.mock("expo-image", () => ({
  Image: { clearDiskCache: jest.fn(async () => true), clearMemoryCache: jest.fn(async () => true) },
}));

const store = secureStore;
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
    // Cached site photos go too.
    expect(Image.clearDiskCache).toHaveBeenCalled();
    expect(Image.clearMemoryCache).toHaveBeenCalled();
  });
});

describe("biometric sign-in", () => {
  const saved = (u = user, token = "old-token") =>
    store.set("vitah_biometric_session", JSON.stringify({ token, user: u }));

  it("signs back in with the saved session after biometrics", async () => {
    saved();
    jest.mocked(api.getProject).mockResolvedValue({ ok: true, data: { project: null } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.biometric).toBe(true));

    let outcome: { error?: string } | undefined;
    await act(async () => {
      outcome = await result.current.signInWithBiometrics("Entrar");
    });

    expect(outcome).toEqual({});
    expect(result.current.token).toBe("old-token");
    expect(result.current.user).toEqual(user);
    expect(store.get("vitah_token")).toBe("old-token");
  });

  it("stays signed out when biometrics are cancelled", async () => {
    saved();
    jest
      .mocked(LocalAuthentication.authenticateAsync)
      .mockResolvedValueOnce({ success: false, error: "user_cancel" });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.biometric).toBe(true));

    await act(async () => {
      expect(await result.current.signInWithBiometrics("Entrar")).toEqual({ error: "cancelled" });
    });
    expect(result.current.token).toBeNull();
  });

  it("forgets an expired session and asks for the password", async () => {
    saved();
    jest.mocked(api.getProject).mockResolvedValue({ ok: false, error: "unauthorized" });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.biometric).toBe(true));

    await act(async () => {
      expect(await result.current.signInWithBiometrics("Entrar")).toEqual({ error: "expired" });
    });
    expect(result.current.token).toBeNull();
    expect(result.current.biometric).toBe(false);
    expect(store.has("vitah_biometric_session")).toBe(false);
  });

  it("keeps it across sign-out, and refreshes it when the same client signs in", async () => {
    saved();
    jest.mocked(api.signIn).mockResolvedValue({ ok: true, data: { token: "new-token", user } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.biometric).toBe(true));

    await act(async () => void (await result.current.signIn("ana@example.com", "pw")));
    await act(() => result.current.signOut());

    expect(result.current.biometric).toBe(true);
    expect(JSON.parse(store.get("vitah_biometric_session")!).token).toBe("new-token");
  });

  it("drops another client's saved session when someone else signs in", async () => {
    saved({ ...user, id: "someone-else" });
    jest.mocked(api.signIn).mockResolvedValue({ ok: true, data: { token: "new-token", user } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.biometric).toBe(true));

    await act(async () => void (await result.current.signIn("ana@example.com", "pw")));

    expect(result.current.biometric).toBe(false);
    expect(store.has("vitah_biometric_session")).toBe(false);
  });
});
