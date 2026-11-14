import { isRunningInExpoGo } from "expo";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { API_BASE } from "./api-config";

// Tells the portal when the app breaks (POST /api/mobile/client-error), so a
// bug in a store build shows in the portal's logs instead of nowhere. It
// sends what broke and where, never whose home it was: no email, no project
// data, and the session token only as the request's usual Authorization
// header (so the log can name the client), never in the report itself.
//
// Silent in tests, in development and in Expo Go, unless the app is started
// with EXPO_PUBLIC_REPORT_ERRORS=1.

const SEND_TIMEOUT_MS = 5000;
/** A broken screen re-rendering in a loop must not flood the portal. */
const MAX_PER_MINUTE = 5;
const MAX_REMEMBERED = 100;
const MAX_MESSAGE = 300;
const MAX_STACK_LINES = 8;
const MAX_STACK = 1500;

/** What the report says, and nothing else. */
export type ErrorReport = {
  message: string;
  stack?: string;
  /** The route's name, e.g. "/(app)/obra/pago/[id]": never the id itself. */
  screen?: string;
  /** The app couldn't go on: it closed, or showed the "something went wrong" screen. */
  fatal: boolean;
  appVersion: string;
  platform: string;
  osVersion: string;
  locale: string;
};

let sessionToken: string | null = null;
let currentScreen: string | undefined;
/** Errors already reported since the app opened. */
const reported = new Set<string>();
let sentAt: number[] = [];

/** The signed-in client's token (null signed out), so a report can say whose phone it was. */
export function setReportSession(token: string | null) {
  sessionToken = token;
}

/** The route shown, so an error caught outside React still says where it happened. */
export function setReportScreen(route: string | undefined) {
  currentScreen = route;
}

function enabled() {
  if (process.env.EXPO_PUBLIC_REPORT_ERRORS === "1") return true;
  // Tests run as development.
  return !__DEV__ && !isRunningInExpoGo();
}

/** An error may quote what the app was handling: emails and tokens stay on the phone. */
function scrub(text: string) {
  return text
    .replace(/[\w.%+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/\beyJ[\w-]+\.[\w-]+(\.[\w-]+)?/g, "[token]")
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [token]");
}

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: `${error.name}: ${error.message}`, stack: error.stack };
  }
  if (typeof error === "string") return { message: error };
  // Anything else thrown (an API result, a response…) may hold the client's data: only say what it was.
  return { message: `Non-error thrown: ${error === null ? "null" : typeof error}` };
}

/** "1.0.0", or "1.0.0+1a2b3c4d" when the code running came over the air (the update's id). */
function appVersion() {
  const version = Constants.expoConfig?.version ?? "unknown";
  try {
    // A build from before the app had expo-updates doesn't have its native half.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Updates = require("expo-updates") as typeof import("expo-updates");
    return !Updates.isEmbeddedLaunch && Updates.updateId ? `${version}+${Updates.updateId.slice(0, 8)}` : version;
  } catch {
    return version;
  }
}

function deviceLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "unknown";
  }
}

async function send(report: ErrorReport) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    await fetch(`${API_BASE}/api/mobile/client-error`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify(report),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reports an error to the portal, once per error and session, a few a minute
 * at most. Fire and forget: it never throws and the promise it returns never
 * rejects; it settles once the report has left (or was dropped), for the one
 * caller that waits a moment before the app closes.
 */
export function reportError(error: unknown, { fatal = false }: { fatal?: boolean } = {}): Promise<void> {
  try {
    if (!enabled()) return Promise.resolve();

    const described = describe(error);
    const message = scrub(described.message).slice(0, MAX_MESSAGE);
    const stack = described.stack
      ? scrub(described.stack.split("\n").slice(0, MAX_STACK_LINES).join("\n")).slice(0, MAX_STACK)
      : undefined;

    // The same error again (a screen failing on every render): said once.
    const key = `${message}\n${stack?.split("\n")[1] ?? ""}`;
    if (reported.has(key)) return Promise.resolve();
    const now = Date.now();
    sentAt = sentAt.filter((at) => now - at < 60_000);
    if (sentAt.length >= MAX_PER_MINUTE) return Promise.resolve();
    if (reported.size >= MAX_REMEMBERED) reported.clear();
    reported.add(key);
    sentAt.push(now);

    return send({
      message,
      ...(stack ? { stack } : {}),
      ...(currentScreen ? { screen: currentScreen } : {}),
      fatal,
      appVersion: appVersion(),
      platform: Platform.OS,
      osVersion: String(Platform.Version ?? "unknown"),
      locale: deviceLocale(),
    }).catch(() => {});
  } catch {
    // Reporting a failure must never be one.
    return Promise.resolve();
  }
}
