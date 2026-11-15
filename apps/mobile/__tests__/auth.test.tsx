import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import { api } from "../lib/api";
import { AuthProvider, useAuth } from "../lib/auth";
import { Image } from "expo-image";
import { clearOffline } from "../lib/offline-cache";
import { clearDocuments } from "../lib/document-store";
import { clearHitoFiles } from "../lib/hito-files";
import { secureStore } from "../test-utils/secure-store";

jest.mock("../lib/api", () => ({ api: { signIn: jest.fn(), getChanges: jest.fn(), removePushToken: jest.fn() } }));
jest.mock("../lib/document-store", () => ({ clearDocuments: jest.fn() }));
jest.mock("../lib/hito-files", () => ({ clearHitoFiles: jest.fn() }));
jest.mock("../lib/offline-cache", () => ({ clearOffline: jest.fn() }));
jest.mock("expo-image", () => ({
  Image: { clearDiskCache: jest.fn(async () => true), clearMemoryCache: jest.fn(async () => true) },
}));

const store = secureStore;
const user = { id: "u", email: "ana@example.com", name: "Ana", role: "client" as const, tenantId: "t" };

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

beforeEach(() => {
  store.clear();
  jest.mocked(api.signIn).mockReset();
  jest.mocked(api.removePushToken).mockReset().mockResolvedValue({ ok: true, data: { success: true } });
  jest.mocked(clearDocuments).mockReset();
  jest.mocked(clearHitoFiles).mockReset();
  jest.mocked(clearOffline).mockReset();
  jest.mocked(Image.clearDiskCache).mockReset().mockResolvedValue(true);
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
    // The homes shown on this phone are forgotten too: the next client starts afresh.
    store.set("vitah_project", "p1");
    store.set("vitah_project_shown", "p1");
    const { result } = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(result.current.token).toBe("stored-token"));

    await act(() => result.current.signOut());

    expect(result.current.token).toBeNull();
    expect(store.size).toBe(0);
    expect(clearDocuments).toHaveBeenCalled();
    expect(clearHitoFiles).toHaveBeenCalled();
    expect(clearOffline).toHaveBeenCalled();
    // Cached site photos go too.
    expect(Image.clearDiskCache).toHaveBeenCalled();
    expect(Image.clearMemoryCache).toHaveBeenCalled();
  });
});

describe("sign-out", () => {
  /** A signed-in client whose phone is registered for pushes. */
  async function signedIn() {
    store.set("vitah_token", "stored-token");
    store.set("vitah_user", JSON.stringify(user));
    store.set("vitah_push_registration", JSON.stringify({ token: "ExponentPushToken[x]", language: "es" }));
    const hook = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(hook.result.current.token).toBe("stored-token"));
    return hook.result;
  }

  it("completes while the server hasn't answered, leaving the push removal for later", async () => {
    let answer!: (result: { ok: false; error: "timeout" }) => void;
    jest.mocked(api.removePushToken).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const result = await signedIn();

    // Resolves although the request is still hanging.
    await act(() => result.current.signOut());

    expect(result.current.token).toBeNull();
    expect(result.current.signedOut).toBe(true);
    expect(store.has("vitah_token")).toBe(false);
    expect(store.has("vitah_user")).toBe(false);
    expect(clearDocuments).toHaveBeenCalled();
    expect(api.removePushToken).toHaveBeenCalledWith("stored-token", "ExponentPushToken[x]");
    expect(JSON.parse(store.get("vitah_push_pending_removal")!)).toEqual({
      authToken: "stored-token",
      pushToken: "ExponentPushToken[x]",
    });

    // The request gives up at last: the removal stays noted for the next open.
    await act(async () => answer({ ok: false, error: "timeout" }));
    expect(store.has("vitah_push_pending_removal")).toBe(true);
  });

  it.each([
    ["the network is down", () => Promise.resolve({ ok: false as const, error: "network_error" as const })],
    ["the server fails", () => Promise.resolve({ ok: false as const, error: "server_error" as const })],
    ["the request throws", () => Promise.reject(new Error("boom"))],
  ])("completes when %s, and sends the push removal on the next open", async (_case, outcome) => {
    jest.mocked(api.removePushToken).mockImplementationOnce(outcome);
    const result = await signedIn();

    await act(() => result.current.signOut());
    await act(async () => {});

    expect(result.current.token).toBeNull();
    expect(store.has("vitah_token")).toBe(false);
    expect(store.has("vitah_push_pending_removal")).toBe(true);

    // The app opens again.
    renderHook(useAuth, { wrapper });
    await waitFor(() => expect(store.has("vitah_push_pending_removal")).toBe(false));
    expect(api.removePushToken).toHaveBeenLastCalledWith("stored-token", "ExponentPushToken[x]");
  });

  it("wipes the offline copies again once signed out, after any load still holding the token", async () => {
    const result = await signedIn();
    const tokenAtWipe: (string | null)[] = [];
    jest.mocked(clearOffline).mockImplementation(async () => void tokenAtWipe.push(result.current.token));

    await act(() => result.current.signOut());

    // Last of the steps (the screens still had the token), then once the token is gone everywhere.
    expect(tokenAtWipe).toEqual(["stored-token", null]);
    expect(jest.mocked(clearOffline).mock.invocationCallOrder[0]).toBeGreaterThan(
      jest.mocked(Image.clearMemoryCache).mock.invocationCallOrder[0]!,
    );
  });

  it("still signs out when a step on the phone fails", async () => {
    jest.mocked(clearDocuments).mockImplementation(() => {
      throw new Error("disk error");
    });
    jest.mocked(Image.clearDiskCache).mockRejectedValue(new Error("cache error"));
    const result = await signedIn();

    await act(() => result.current.signOut());

    expect(result.current.token).toBeNull();
    expect(result.current.signedOut).toBe(true);
    expect(store.has("vitah_token")).toBe(false);
    // The steps after the failed ones ran too.
    expect(clearHitoFiles).toHaveBeenCalled();
    expect(clearOffline).toHaveBeenCalled();
    expect(Image.clearMemoryCache).toHaveBeenCalled();
  });
});

describe("biometric sign-in", () => {
  const saved = (u = user, token = "old-token") =>
    store.set("vitah_biometric_session", JSON.stringify({ token, user: u }));

  it("signs back in with the saved session after biometrics", async () => {
    saved();
    jest.mocked(api.getChanges).mockResolvedValue({ ok: true, data: { changes: null, projects: "" } });
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
    jest.mocked(api.getChanges).mockResolvedValue({ ok: false, error: "unauthorized" });
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

  it("swaps in a fresh token after a password change, in the saved session too", async () => {
    store.set("vitah_token", "old-token");
    store.set("vitah_user", JSON.stringify(user));
    saved();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.token).toBe("old-token"));

    await act(() => result.current.replaceToken("fresh-token"));

    expect(result.current.token).toBe("fresh-token");
    expect(store.get("vitah_token")).toBe("fresh-token");
    expect(JSON.parse(store.get("vitah_biometric_session")!).token).toBe("fresh-token");
  });

  it("doesn't turn biometric sign-in on when swapping the token", async () => {
    store.set("vitah_token", "old-token");
    store.set("vitah_user", JSON.stringify(user));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.token).toBe("old-token"));

    await act(() => result.current.replaceToken("fresh-token"));

    expect(store.has("vitah_biometric_session")).toBe(false);
  });
});
