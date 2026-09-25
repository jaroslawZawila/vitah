import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { Text } from "react-native";
import { AppLockProvider, useAppLock } from "../lib/app-lock";
import { AuthProvider, useAuth } from "../lib/auth";
import { secureStore } from "../test-utils/secure-store";

jest.mock("../lib/api", () => ({ api: {} }));
jest.mock("../lib/document-store", () => ({ clearDocuments: jest.fn() }));
jest.mock("../lib/push", () => ({
  unregisterPush: jest.fn(async () => {}),
  retryPendingRemoval: jest.fn(async () => {}),
}));
jest.mock("expo-image", () => ({
  Image: { clearDiskCache: jest.fn(async () => true), clearMemoryCache: jest.fn(async () => true) },
}));

const user = { id: "u1", email: "ana@example.com", name: "Ana", tenantId: "t" };
const session = JSON.stringify({ token: "tok", user });

let lock: ReturnType<typeof useAppLock>;
let auth: ReturnType<typeof useAuth>;
function Probe() {
  lock = useAppLock();
  auth = useAuth();
  return <Text>contenido</Text>;
}

const renderLock = () =>
  render(
    <AuthProvider>
      <AppLockProvider>
        <Probe />
      </AppLockProvider>
    </AuthProvider>,
  );

/** Signed in, as the app finds it on launch. */
function signedIn() {
  secureStore.set("vitah_token", "tok");
  secureStore.set("vitah_user", JSON.stringify(user));
}

const cancel = () =>
  jest
    .mocked(LocalAuthentication.authenticateAsync)
    .mockResolvedValueOnce({ success: false, error: "user_cancel" });

beforeEach(() => {
  jest.clearAllMocks();
  secureStore.clear();
});

describe("AppLockProvider", () => {
  it("knows whether the phone has biometrics", async () => {
    renderLock();

    await waitFor(() => expect(lock.available).toBe(true));
    expect(lock.enabled).toBe(false);
  });

  it("asks for biometrics before turning biometric access on, without locking", async () => {
    signedIn();
    renderLock();
    await screen.findByText("contenido");
    cancel();

    await act(async () => expect(await lock.setEnabled(true)).toBe(false));
    expect(lock.enabled).toBe(false);

    await act(async () => expect(await lock.setEnabled(true)).toBe(true));
    expect(lock.enabled).toBe(true);
    expect(JSON.parse(secureStore.get("vitah_biometric_session")!)).toEqual({ token: "tok", user });
    expect(screen.queryByText("ViTAH está bloqueada")).toBeNull();
  });

  it("opens locked when signed in with biometric access on, until biometrics succeed", async () => {
    signedIn();
    secureStore.set("vitah_biometric_session", session);
    cancel();

    renderLock();

    expect(await screen.findByText("ViTAH está bloqueada")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Desbloquear" }));
    await waitFor(() => expect(screen.queryByText("ViTAH está bloqueada")).toBeNull());
  });

  it("lets a locked-out client sign out, keeping biometric sign-in", async () => {
    signedIn();
    secureStore.set("vitah_biometric_session", session);
    jest
      .mocked(LocalAuthentication.authenticateAsync)
      .mockResolvedValue({ success: false, error: "user_cancel" });

    renderLock();
    fireEvent.press(await screen.findByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(auth.token).toBeNull());
    expect(screen.queryByText("ViTAH está bloqueada")).toBeNull();
    expect(auth.biometric).toBe(true);
    jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: true });
  });

  it("turning it off forgets the saved session", async () => {
    signedIn();
    secureStore.set("vitah_biometric_session", session);
    renderLock();
    await screen.findByText("contenido");

    await act(async () => expect(await lock.setEnabled(false)).toBe(true));

    expect(lock.enabled).toBe(false);
    expect(secureStore.has("vitah_biometric_session")).toBe(false);
  });
});
