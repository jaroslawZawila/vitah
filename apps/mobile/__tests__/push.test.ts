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
  /** The removal sent in the background has had its (mocked, immediate) answer. */
  const removalSettled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it("removes the stored token from the server and the phone", async () => {
    await registerForPush("tok", "es", { ask: true });

    await unregisterPush("tok");
    await removalSettled();

    expect(api.removePushToken).toHaveBeenCalledTimes(1);
    expect(api.removePushToken).toHaveBeenCalledWith("tok", "ExponentPushToken[test]");
    expect(secureStore.has("vitah_push_registration")).toBe(false);
    expect(secureStore.has("vitah_push_pending_removal")).toBe(false);
    // Signing in again registers again.
    await registerForPush("tok", "es", { ask: true });
    expect(api.registerPushToken).toHaveBeenCalledTimes(2);
  });

  it("doesn't wait for the server: the removal is noted on the phone and sent in the background", async () => {
    await registerForPush("tok", "es", { ask: true });
    let answer!: (result: { ok: true; data: { success: true } }) => void;
    jest.mocked(api.removePushToken).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));

    // Resolves although the server hasn't answered (it may never, offline).
    await unregisterPush("tok");

    expect(secureStore.has("vitah_push_registration")).toBe(false);
    expect(JSON.parse(secureStore.get("vitah_push_pending_removal")!)).toEqual({
      authToken: "tok",
      pushToken: "ExponentPushToken[test]",
    });

    answer({ ok: true, data: { success: true } });
    await removalSettled();
    expect(secureStore.has("vitah_push_pending_removal")).toBe(false);
  });

  it.each(["network_error", "timeout", "server_error"] as const)(
    "retries the removal when the app next opens after a %s",
    async (error) => {
      await registerForPush("tok", "es", { ask: true });
      jest.mocked(api.removePushToken).mockResolvedValueOnce({ ok: false, error });

      await unregisterPush("tok");
      await removalSettled();
      expect(secureStore.has("vitah_push_pending_removal")).toBe(true);

      await retryPendingRemoval();
      expect(api.removePushToken).toHaveBeenLastCalledWith("tok", "ExponentPushToken[test]");
      expect(secureStore.has("vitah_push_pending_removal")).toBe(false);
    },
  );

  it("keeps the removal for later when sending it throws", async () => {
    await registerForPush("tok", "es", { ask: true });
    jest.mocked(api.removePushToken).mockRejectedValueOnce(new Error("boom"));

    await unregisterPush("tok");
    await removalSettled();

    expect(secureStore.has("vitah_push_pending_removal")).toBe(true);
    await expect(retryPendingRemoval()).resolves.toBeUndefined();
    expect(secureStore.has("vitah_push_pending_removal")).toBe(false);
  });

  it("gives up on a removal once that session is rejected", async () => {
    await registerForPush("tok", "es", { ask: true });
    jest.mocked(api.removePushToken).mockResolvedValueOnce({ ok: false, error: "unauthorized" });

    await unregisterPush("tok");
    await removalSettled();

    expect(secureStore.has("vitah_push_pending_removal")).toBe(false);
  });

  it("lets a removal on its way land before the phone registers again, so it can't undo it", async () => {
    await registerForPush("tok", "es", { ask: true });
    let answer!: (result: { ok: true; data: { success: true } }) => void;
    jest.mocked(api.removePushToken).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await unregisterPush("tok");

    // The same client signs straight back in.
    const registered = registerForPush("tok-2", "es", { ask: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(api.registerPushToken).toHaveBeenCalledTimes(1);

    answer({ ok: true, data: { success: true } });
    expect(await registered).toBe("registered");
    expect(api.registerPushToken).toHaveBeenLastCalledWith("tok-2", "ExponentPushToken[test]", "es");
  });

  it("drops a removal that never got there once the phone is registered again", async () => {
    await registerForPush("tok", "es", { ask: true });
    jest.mocked(api.removePushToken).mockResolvedValueOnce({ ok: false, error: "network_error" });
    await unregisterPush("tok");
    await removalSettled();
    jest.mocked(api.removePushToken).mockClear();

    await registerForPush("tok-2", "es", { ask: true });

    // Sent later, it would take the fresh registration away.
    expect(secureStore.has("vitah_push_pending_removal")).toBe(false);
    await retryPendingRemoval();
    expect(api.removePushToken).not.toHaveBeenCalled();
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

  it("opens the Obra tab for a new handover date", () => {
    jest.mocked(Notifications.useLastNotificationResponse).mockReturnValue(tapped("n-obra", "obra"));
    renderHook(() => usePushNotifications("tok", "es"));
    expect(mockNavigate).toHaveBeenCalledWith("/obra");
  });

  it("opens the warranty claim a notification is about, else the Garantía screen", () => {
    jest.mocked(Notifications.useLastNotificationResponse).mockReturnValue({
      notification: { request: { identifier: "n-claim", content: { data: { screen: "warranty", claimId: "c-1" } } } },
    } as never);
    renderHook(() => usePushNotifications("tok", "es"));
    expect(mockNavigate).toHaveBeenCalledWith("/warranty/c-1");

    jest.mocked(Notifications.useLastNotificationResponse).mockReturnValue(tapped("n-warranty", "warranty"));
    renderHook(() => usePushNotifications("tok", "es"));
    expect(mockNavigate).toHaveBeenLastCalledWith("/warranty");
  });

  it("shows the home a notification is about before opening its tab", () => {
    const showProject = jest.fn();
    jest.mocked(Notifications.useLastNotificationResponse).mockReturnValue({
      notification: { request: { identifier: "n-home", content: { data: { screen: "documents", projectId: "p2" } } } },
    } as never);

    renderHook(() => usePushNotifications("tok", "es", showProject));

    expect(showProject).toHaveBeenCalledWith("p2");
    expect(mockNavigate).toHaveBeenCalledWith("/documents");
    expect(showProject.mock.invocationCallOrder[0]).toBeLessThan(mockNavigate.mock.invocationCallOrder[0]!);
  });
});

describe("in Expo Go on Android", () => {
  // Android's Expo Go has had no push since SDK 53; from SDK 55 even loading
  // expo-notifications there throws. The app must still start, without push.
  function loadPush() {
    let push!: typeof import("../lib/push");
    const react = jest.requireActual("react");
    jest.isolateModules(() => {
      // The hook must use the same React as renderHook.
      jest.doMock("react", () => react);
      jest.doMock("expo", () => ({ isRunningInExpoGo: () => true }));
      jest.doMock("expo-notifications", () => {
        throw new Error("expo-notifications: Android Push notifications … removed from Expo Go");
      });
      const { Platform } = jest.requireActual("react-native");
      Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
      push = jest.requireActual("../lib/push");
    });
    return push;
  }

  afterEach(() => {
    const { Platform } = jest.requireActual("react-native");
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
  });

  it("starts without push instead of crashing", async () => {
    const push = loadPush();

    expect(await push.registerForPush("tok", "es", { ask: true })).toBe("unavailable");
    expect(await push.notificationsAllowed()).toBe(false);
    const { result } = renderHook(() => push.usePushNotifications("tok", "es"));
    expect(result.current).toBeUndefined();
    expect(api.registerPushToken).not.toHaveBeenCalled();
  });
});
