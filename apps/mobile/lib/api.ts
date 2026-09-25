import type {
  MobileDocument,
  MobilePhoto,
  MobileProject,
  MobileSession,
  PhotoSize,
} from "@repo/core/contract";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export type AuthUser = MobileSession["user"];
export type Project = MobileProject;

type ApiError = "invalid_credentials" | "unauthorized" | "network_error" | "server_error";

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

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
  if (!res.ok) return { ok: false, error: "server_error" };

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
    return request<{ project: Project | null }>("/api/mobile/project", {
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  listDocuments(token: string) {
    return request<{ documents: MobileDocument[] }>("/api/mobile/documents", {
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  /** The PDF itself; fetch it with the same Bearer token. */
  documentUrl(id: string) {
    return `${API_BASE}/api/mobile/documents/${encodeURIComponent(id)}`;
  },

  listPhotos(token: string) {
    return request<{ photos: MobilePhoto[] }>("/api/mobile/photos", {
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  /** The image itself (or its small WebP thumbnail); load it with the same Bearer token. */
  photoUrl(id: string, size: PhotoSize = "full") {
    // Same rule as photoSizeQuery in @repo/core/contract (the app imports only its types).
    const query = size === "full" ? "" : `?size=${size}`;
    return `${API_BASE}/api/mobile/photos/${encodeURIComponent(id)}${query}`;
  },
};
