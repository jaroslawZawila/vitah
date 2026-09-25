import type { AppLanguage } from "@repo/core/contract";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect } from "react";
import { Platform } from "react-native";
import { api } from "./api";

// Push notifications: the server sends one when staff share a photo or a
// document (if the client's Perfil toggle is on), in the phone's app
// language. The phone registers its Expo push token and language after
// sign-in, again only if either changes, and removes it on sign-out.

/** What this phone last registered: `{ token, language }` as JSON. */
const REGISTERED_KEY = "vitah_push_registration";

/**
 * A sign-out whose removal didn't reach the server (e.g. offline): retried
 * when the app next opens, so the phone stops getting that client's pushes.
 */
const PENDING_REMOVAL_KEY = "vitah_push_pending_removal";

type Registration = { token: string; language: AppLanguage };

async function lastRegistration(): Promise<Registration | null> {
  const json = await SecureStore.getItemAsync(REGISTERED_KEY).catch(() => null);
  return json ? (JSON.parse(json) as Registration) : null;
}

// Show notifications while the app is open too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * "denied": the client said no (they can change it in the phone's settings).
 * "unavailable": the build can't get a push token, e.g. no EAS project id or
 * a simulator.
 */
export type PushStatus = "registered" | "denied" | "unavailable";

/** Registers this phone for the client's notifications, asking for permission if `ask`. */
export async function registerForPush(
  authToken: string,
  language: AppLanguage,
  { ask }: { ask: boolean },
): Promise<PushStatus> {
  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return "unavailable";

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "ViTAH",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  let { status } = current;
  if (status !== "granted" && ask && current.canAskAgain) {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== "granted") return "denied";

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const last = await lastRegistration();
    if (last?.token === token && last.language === language) return "registered";
    const result = await api.registerPushToken(authToken, token, language);
    if (!result.ok) return "unavailable";
    await SecureStore.setItemAsync(REGISTERED_KEY, JSON.stringify({ token, language }));
    return "registered";
  } catch {
    return "unavailable";
  }
}

/**
 * Stops this phone getting the client's notifications; called on sign-out.
 * If the server can't be reached, the removal is kept and retried later.
 */
export async function unregisterPush(authToken: string) {
  const last = await lastRegistration();
  // Whoever signs in next registers afresh.
  await SecureStore.deleteItemAsync(REGISTERED_KEY).catch(() => {});
  if (!last) return;
  const pending = { authToken, pushToken: last.token };
  if (!(await removeOnServer(pending))) {
    await SecureStore.setItemAsync(PENDING_REMOVAL_KEY, JSON.stringify(pending)).catch(() => {});
  }
}

/** Retries a removal that failed at sign-out; call when the app opens. */
export async function retryPendingRemoval() {
  const json = await SecureStore.getItemAsync(PENDING_REMOVAL_KEY).catch(() => null);
  if (json && (await removeOnServer(JSON.parse(json) as PendingRemoval))) {
    await SecureStore.deleteItemAsync(PENDING_REMOVAL_KEY).catch(() => {});
  }
}

type PendingRemoval = { authToken: string; pushToken: string };

/** Whether it's done. A rejected (expired) session can't remove it, so retrying won't help. */
async function removeOnServer({ authToken, pushToken }: PendingRemoval) {
  const result = await api.removePushToken(authToken, pushToken);
  return result.ok || result.error === "unauthorized";
}

/** Whether the phone lets ViTAH show notifications. */
export async function notificationsAllowed() {
  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted";
}

const SCREENS = { photos: "/photos", documents: "/documents" } as const;

/**
 * The last tapped notification stays "last" until another is tapped; this
 * keeps it from reopening its tab after a remount or a new sign-in.
 */
let handledNotification: string | undefined;

/**
 * After sign-in: registers the phone (asking once, and again when the
 * language changes) and opens the right tab when a notification is tapped.
 */
export function usePushNotifications(authToken: string | null, language: AppLanguage) {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (authToken) void registerForPush(authToken, language, { ask: true });
  }, [authToken, language]);

  useEffect(() => {
    if (!authToken || !response) return;
    const { identifier, content } = response.notification.request;
    if (identifier === handledNotification) return;
    handledNotification = identifier;
    const screen = content.data?.screen;
    if (screen === "photos" || screen === "documents") router.navigate(SCREENS[screen]);
  }, [authToken, response, router]);
}
