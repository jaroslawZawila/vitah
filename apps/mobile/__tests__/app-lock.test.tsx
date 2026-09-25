import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { Text } from "react-native";
import { AppLockProvider, useAppLock } from "../lib/app-lock";
import { secureStore } from "../test-utils/secure-store";

const mockAuth = { token: "tok" as string | null, isLoading: false, signOut: jest.fn() };
jest.mock("../lib/auth", () => ({ useAuth: () => mockAuth }));

let lock: ReturnType<typeof useAppLock>;
function Probe() {
  lock = useAppLock();
  return <Text>contenido</Text>;
}

const renderLock = () =>
  render(
    <AppLockProvider>
      <Probe />
    </AppLockProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  secureStore.clear();
  mockAuth.token = "tok";
});

describe("AppLockProvider", () => {
  it("reports the phone's biometrics", async () => {
    renderLock();
    await screen.findByText("contenido");

    await waitFor(() => expect(lock.available).toBe(true));
    // Face recognition; "faceId" on iOS (the test platform).
    expect(lock.method).toBe("faceId");
    expect(lock.enabled).toBe(false);
  });

  it("asks for biometrics before turning the lock on", async () => {
    renderLock();
    await screen.findByText("contenido");
    jest
      .mocked(LocalAuthentication.authenticateAsync)
      .mockResolvedValueOnce({ success: false, error: "user_cancel" });

    await act(async () => expect(await lock.setEnabled(true)).toBe(false));
    expect(lock.enabled).toBe(false);

    await act(async () => expect(await lock.setEnabled(true)).toBe(true));
    expect(lock.enabled).toBe(true);
    expect(secureStore.get("vitah_app_lock")).toBe("1");
    // They've just passed biometrics: no lock screen now.
    expect(screen.queryByText("ViTAH está bloqueada")).toBeNull();
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(2);
  });

  it("shows nothing of the app until it knows whether to lock", async () => {
    secureStore.set("vitah_app_lock", "1");
    jest
      .mocked(LocalAuthentication.authenticateAsync)
      .mockResolvedValueOnce({ success: false, error: "user_cancel" });

    renderLock();

    expect(screen.queryByText("contenido")).toBeNull();
    expect(await screen.findByText("ViTAH está bloqueada")).toBeOnTheScreen();
  });

  it("locks when the app opens with the lock on, until biometrics succeed", async () => {
    secureStore.set("vitah_app_lock", "1");
    jest
      .mocked(LocalAuthentication.authenticateAsync)
      .mockResolvedValueOnce({ success: false, error: "user_cancel" });

    renderLock();

    expect(await screen.findByText("ViTAH está bloqueada")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Desbloquear" }));
    await waitFor(() => expect(screen.queryByText("ViTAH está bloqueada")).toBeNull());
  });

  it("lets a locked-out client sign out instead", async () => {
    secureStore.set("vitah_app_lock", "1");
    jest
      .mocked(LocalAuthentication.authenticateAsync)
      .mockResolvedValue({ success: false, error: "user_cancel" });

    renderLock();
    fireEvent.press(await screen.findByRole("button", { name: "Cerrar sesión" }));

    expect(mockAuth.signOut).toHaveBeenCalled();
    jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: true });
  });

  it("turns the lock off on sign-out, for the next person on the phone", async () => {
    secureStore.set("vitah_app_lock", "1");
    mockAuth.token = null;

    renderLock();

    await waitFor(() => expect(secureStore.has("vitah_app_lock")).toBe(false));
    expect(screen.queryByText("ViTAH está bloqueada")).toBeNull();
  });
});
