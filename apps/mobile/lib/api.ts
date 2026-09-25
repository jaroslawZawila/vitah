import {
  photoSizeQuery,
  type AccountError,
  type AppLanguage,
  type MobileDocument,
  type MobilePhoto,
  type MobileProject,
  type MobileSession,
  type MobileSettings,
  type NotificationPrefs,
  type PhotoSize,
} from "@repo/core/contract";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export type AuthUser = MobileSession["user"];
export type Project = MobileProject;

type ApiError =
  | "invalid_credentials"
  | "unauthorized"
  | "network_error"
  | "server_error"
  // The code of another 4xx, e.g. "wrong_password" from /password.
  | AccountError;

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** A signed-in client's request; `body` is sent as JSON. */
function authed<T>(path: string, token: string, method = "GET", body?: unknown) {
  return request<T>(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    return { ok: false, error: "network_error" };
  }

  if (res.status === 401) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return {
      ok: false,
      error: body?.error === "invalid_credentials" ? "invalid_credentials" : "unauthorized",
    };
  }
  if (!res.ok) {
    // A 4xx says what was wrong in `{ error: code }`; anything else is ours.
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const code = res.status < 500 && typeof body?.error === "string" ? body.error : null;
    return { ok: false, error: (code as AccountError | null) ?? "server_error" };
  }

  try {
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, error: "server_error" };
  }
}

// ─── Social login (future) ────────────────────────────────────────────────────
// Add signInWithProvider(provider: 'google' | 'apple', idToken: string) here.
// Call POST /api/mobile/auth/social with { provider, idToken }.
// The server validates the idToken, looks up the client by email,
// and returns the same { token, user } shape — no changes needed in auth.tsx.
// ─────────────────────────────────────────────────────────────────────────────

export const api = {
  signIn(email: string, password: string) {
    return request<MobileSession>("/api/mobile/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  },

  getProject(token: string) {
    return authed<{ project: Project | null }>("/api/mobile/project", token);
  },

  listDocuments(token: string) {
    return authed<{ documents: MobileDocument[] }>("/api/mobile/documents", token);
  },

  /** The PDF itself; fetch it with the same Bearer token. */
  documentUrl(id: string) {
    return `${API_BASE}/api/mobile/documents/${encodeURIComponent(id)}`;
  },

  listPhotos(token: string) {
    return authed<{ photos: MobilePhoto[] }>("/api/mobile/photos", token);
  },

  /** The image itself (or its small WebP thumbnail); load it with the same Bearer token. */
  photoUrl(id: string, size: PhotoSize = "full") {
    return `${API_BASE}/api/mobile/photos/${encodeURIComponent(id)}${photoSizeQuery(size)}`;
  },

  getSettings(token: string) {
    return authed<MobileSettings>("/api/mobile/settings", token);
  },

  /** Saves the given notification flags; returns all settings. */
  updateSettings(token: string, notifications: Partial<NotificationPrefs>) {
    return authed<MobileSettings>("/api/mobile/settings", token, "PUT", { notifications });
  },

  changePassword(token: string, currentPassword: string, newPassword: string) {
    return authed<{ success: true }>("/api/mobile/password", token, "POST", {
      currentPassword,
      newPassword,
    });
  },

  /** Registers this phone for pushes, written in its app `language`. */
  registerPushToken(token: string, pushToken: string, language: AppLanguage) {
    return authed<{ success: true }>("/api/mobile/push-token", token, "POST", {
      token: pushToken,
      language,
    });
  },

  removePushToken(token: string, pushToken: string) {
    return authed<{ success: true }>("/api/mobile/push-token", token, "DELETE", {
      token: pushToken,
    });
  },
};
