import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { api } from "../lib/api";
import { renderHook } from "@testing-library/react-native";
import {
  registerForPush,
  retryPendingRemoval,
  unregisterPush,
  usePushNotifications,
} from "../lib/push";
import { secureStore } from "../test-utils/secure-store";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: "project-1" } } } },
}));
const mockNavigate = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ navigate: mockNavigate }) }));
jest.mock("../lib/api", () => ({
  api: {
    registerPushToken: jest.fn(async () => ({ ok: true, data: { success: true } })),
    removePushToken: jest.fn(async () => ({ ok: true, data: { success: true } })),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  secureStore.clear();
});

describe("registerForPush", () => {
  it("asks for permission, then registers the phone's token", async () => {
    expect(await registerForPush("tok", "es", { ask: true })).toBe("registered");

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "project-1" });
    expect(api.registerPushToken).toHaveBeenCalledWith("tok", "ExponentPushToken[test]", "es");
  });

  it("registers again only when the token or the language changes", async () => {
    await registerForPush("tok", "es", { ask: true });
    await registerForPush("tok", "es", { ask: true });
    expect(api.registerPushToken).toHaveBeenCalledTimes(1);

    await registerForPush("tok", "en", { ask: true });
    expect(api.registerPushToken).toHaveBeenLastCalledWith("tok", "ExponentPushToken[test]", "en");
    expect(api.registerPushToken).toHaveBeenCalledTimes(2);
  });

  it("doesn't ask unless told to", async () => {
    expect(await registerForPush("tok", "es", { ask: false })).toBe("denied");

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(api.registerPushToken).not.toHaveBeenCalled();
  });

  it("respects a refusal", async () => {
    jest
      .mocked(Notifications.requestPermissionsAsync)
      .mockResolvedValueOnce({ status: "denied", canAskAgain: false } as never);

    expect(await registerForPush("tok", "es", { ask: true })).toBe("denied");
    expect(api.registerPushToken).not.toHaveBeenCalled();
  });

  it("is unavailable without an EAS project id", async () => {
    const config = Constants.expoConfig!;
    const extra = config.extra;
    config.extra = {};
    try {
      expect(await registerForPush("tok", "es", { ask: true })).toBe("unavailable");
      expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    } finally {
      config.extra = extra;
    }
  });

  it("is unavailable when the phone can't get a token (e.g. a simulator)", async () => {
    jest.mocked(Notifications.getExpoPushTokenAsync).mockRejectedValueOnce(new Error("no device"));

    expect(await registerForPush("tok", "es", { ask: true })).toBe("unavailable");
  });
});

describe("unregisterPush", () => {
  it("removes the stored token from the server and the phone", async () => {
    await registerForPush("tok", "es", { ask: true });

    await unregisterPush("tok");

    expect(api.removePushToken).toHaveBeenCalledWith("tok", "ExponentPushToken[test]");
    expect(secureStore.has("vitah_push_registration")).toBe(false);
    // Signing in again registers again.
    await registerForPush("tok", "es", { ask: true });
    expect(api.registerPushToken).toHaveBeenCalledTimes(2);
  });

  it("retries the removal when the app next opens if the server wasn't reached", async () => {
    await registerForPush("tok", "es", { ask: true });
    jest.mocked(api.removePushToken).mockResolvedValueOnce({ ok: false, error: "network_error" });

    await unregisterPush("tok");
    expect(secureStore.has("vitah_push_pending_removal")).toBe(true);

    await retryPendingRemoval();
    expect(api.removePushToken).toHaveBeenLastCalledWith("tok", "ExponentPushToken[test]");
    expect(secureStore.has("vitah_push_pending_removal")).toBe(false);
  });

  it("gives up on a removal once that session is rejected", async () => {
    await registerForPush("tok", "es", { ask: true });
    jest.mocked(api.removePushToken).mockResolvedValueOnce({ ok: false, error: "unauthorized" });

    await unregisterPush("tok");

    expect(secureStore.has("vitah_push_pending_removal")).toBe(false);
  });

  it("does nothing when the phone never registered", async () => {
    await unregisterPush("tok");

    expect(api.removePushToken).not.toHaveBeenCalled();
  });
});

describe("usePushNotifications", () => {
  const tapped = (identifier: string, screen: string) =>
    ({ notification: { request: { identifier, content: { data: { screen } } } } }) as never;

  it("opens a tapped notification's tab once, even after signing in again", () => {
    jest.mocked(Notifications.useLastNotificationResponse).mockReturnValue(tapped("n-1", "photos"));

    const { rerender, unmount } = renderHook(
      ({ token }: { token: string | null }) => usePushNotifications(token, "es"),
      { initialProps: { token: "tok" as string | null } },
    );
    expect(mockNavigate).toHaveBeenCalledWith("/photos");

    rerender({ token: null });
    rerender({ token: "tok" });
    unmount();
    renderHook(() => usePushNotifications("tok", "es"));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});
