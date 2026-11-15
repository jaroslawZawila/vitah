import {
  DOCUMENT_CATEGORIES,
  photoSizeQuery,
  type AccountError,
  type ApprovalDecisionInput,
  type ApprovalError,
  type ClientSettingsInput,
  type DeletionRequest,
  type MobileApproval,
  type MobileApprovalDecisionReply,
  type MobileChangesReply,
  type MobileContact,
  type HitoFileKind,
  type MobileObra,
  type AppLanguage,
  type MobileDocument,
  type MobilePhoto,
  type MobileProject,
  type MobileSession,
  type MobileSettings,
  type MobileSignInInput,
  type NotificationPrefs,
  type PasswordChangeInput,
  type PhotoSize,
  type PushTokenInput,
  type PushTokenRemovalInput,
  type MobileWarranty,
  type MobileWarrantyClaim,
  type WarrantyClaimInput,
  type WarrantyError,
} from "@repo/core/contract";
import { API_BASE, DOWNLOAD_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from "./api-config";

export type AuthUser = MobileSession["user"];
export type Project = MobileProject;

/**
 * How a call failed, each told apart so the app can say what happened:
 * - `network_error`: the server couldn't be reached (offline, DNS, TLS)
 * - `timeout`: no full answer within the call's time
 * - `server_error`: a 5xx, or an answer the app can't read
 * - `unauthorized`: the session was rejected (expired, revoked): sign in again
 * - `invalid_credentials`: wrong email or password, on sign-in only
 */
export type ApiError =
  | "invalid_credentials"
  | "unauthorized"
  | "network_error"
  | "timeout"
  | "server_error"
  // The code of another 4xx, e.g. "wrong_password" from /password.
  | AccountError
  | ApprovalError
  | WarrantyError;

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

/** `?projectId=`: which of the client's homes a call is about (none: the server's default one). */
function forProject(path: string, projectId: string | null | undefined) {
  if (!projectId) return path;
  return `${path}${path.includes("?") ? "&" : "?"}projectId=${encodeURIComponent(projectId)}`;
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Result<T>> {
  // Nothing may hang: past the timeout the call is aborted, whether it was
  // still connecting or half-way through the answer.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const failed = (): Result<T> => ({ ok: false, error: timedOut ? "timeout" : "network_error" });

  try {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
    } catch {
      return failed();
    }

    if (res.status === 401) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (timedOut) return failed();
      return {
        ok: false,
        error: body?.error === "invalid_credentials" ? "invalid_credentials" : "unauthorized",
      };
    }
    if (!res.ok) {
      // A 4xx says what was wrong in `{ error: code }`; anything else is ours.
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (timedOut) return failed();
      const code = res.status < 500 && typeof body?.error === "string" ? body.error : null;
      return { ok: false, error: (code as ApiError | null) ?? "server_error" };
    }

    try {
      return { ok: true, data: (await res.json()) as T };
    } catch {
      // Cut off while reading the answer, or an answer that isn't JSON.
      return timedOut ? failed() : { ok: false, error: "server_error" };
    }
  } finally {
    clearTimeout(timer);
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
      body: JSON.stringify({ email, password } satisfies MobileSignInInput),
    });
  },

  /** Every home of the client, the one to open on first (the newest not yet handed over). */
  listProjects(token: string) {
    return authed<{ projects: Project[] }>("/api/mobile/projects", token);
  },

  /**
   * A counter per part of the app for the home shown; one that moved means
   * reload that part (null without a home). `projects` moves when the list of
   * homes does.
   */
  getChanges(token: string, projectId?: string | null) {
    return authed<MobileChangesReply>(forProject("/api/mobile/changes", projectId), token);
  },

  /** The Obra tab: stage, progress, phases and payment hitos; null without a project. */
  getObra(token: string, projectId?: string | null) {
    return authed<{ obra: MobileObra | null }>(forProject("/api/mobile/obra", projectId), token);
  },

  /** A hito's signed acta or invoice (PDF); fetch it with the same Bearer token. */
  hitoFileUrl(hitoId: string, kind: HitoFileKind) {
    return `${API_BASE}/api/mobile/obra/hitos/${encodeURIComponent(hitoId)}/${kind}`;
  },

  /** The categories it knows go along, so newer ones arrive as "other" until the app learns them. */
  listDocuments(token: string, projectId?: string | null) {
    return authed<{ documents: MobileDocument[] }>(
      forProject(`/api/mobile/documents?categories=${DOCUMENT_CATEGORIES.join(",")}`, projectId),
      token,
    );
  },

  /** The PDF itself; fetch it with the same Bearer token. */
  documentUrl(id: string) {
    return `${API_BASE}/api/mobile/documents/${encodeURIComponent(id)}`;
  },

  listPhotos(token: string, projectId?: string | null) {
    return authed<{ photos: MobilePhoto[] }>(forProject("/api/mobile/photos", projectId), token);
  },

  /** The image itself (or its small WebP thumbnail); load it with the same Bearer token. */
  photoUrl(id: string, size: PhotoSize = "full") {
    return `${API_BASE}/api/mobile/photos/${encodeURIComponent(id)}${photoSizeQuery(size)}`;
  },

  /** Contacto: the home's site manager and the builder's office (each null when not given). */
  getContact(token: string, projectId?: string | null) {
    return authed<MobileContact>(forProject("/api/mobile/contact", projectId), token);
  },

  getSettings(token: string) {
    return authed<MobileSettings>("/api/mobile/settings", token);
  },

  /** Saves the given notification flags; returns all settings. */
  updateSettings(token: string, notifications: Partial<NotificationPrefs>) {
    return authed<MobileSettings>("/api/mobile/settings", token, "PUT", { notifications } satisfies ClientSettingsInput);
  },

  /** Asks the builder to delete the client's account (asking again keeps the first date). */
  requestDeletion(token: string) {
    return authed<DeletionRequest>("/api/mobile/account/deletion-request", token, "POST");
  },

  /** Withdraws that request. */
  withdrawDeletion(token: string) {
    return authed<DeletionRequest>("/api/mobile/account/deletion-request", token, "DELETE");
  },

  /**
   * Changing the password signs every phone out; `token` (a fresh session for
   * this one) is missing from servers older than that.
   */
  changePassword(token: string, currentPassword: string, newPassword: string) {
    return authed<{ success: true; token?: string }>("/api/mobile/password", token, "POST", {
      currentPassword,
      newPassword,
    } satisfies PasswordChangeInput);
  },

  /**
   * The change to the contract waiting for the client's answer on the home
   * shown (null: none). A server from before it answers 404: no request.
   */
  getApproval(token: string, projectId?: string | null) {
    return authed<{ approval: MobileApproval | null }>(forProject("/api/mobile/approvals", projectId), token);
  },

  /** The client's answer: approving needs their password, rejecting a reason. */
  decideApproval(token: string, approvalId: string, body: ApprovalDecisionInput) {
    return authed<MobileApprovalDecisionReply>(
      `/api/mobile/approvals/${encodeURIComponent(approvalId)}/decision`,
      token,
      "POST",
      body,
    );
  },

  /** Registers this phone for pushes, written in its app `language`. */
  registerPushToken(token: string, pushToken: string, language: AppLanguage) {
    return authed<{ success: true }>("/api/mobile/push-token", token, "POST", {
      token: pushToken,
      language,
    } satisfies PushTokenInput);
  },

  removePushToken(token: string, pushToken: string) {
    return authed<{ success: true }>("/api/mobile/push-token", token, "DELETE", {
      token: pushToken,
    } satisfies PushTokenRemovalInput);
  },

  // ─── Garantía (warranty claims) ──────────────────────────────────────────────

  /** The home's hand-over, its LOE periods and the client's claims, newest first; null without a home. */
  getWarranty(token: string, projectId?: string | null) {
    return authed<{ warranty: MobileWarranty | null }>(forProject("/api/mobile/warranty", projectId), token);
  },

  getWarrantyClaim(token: string, claimId: string) {
    return authed<MobileWarrantyClaim>(`/api/mobile/warranty/${encodeURIComponent(claimId)}`, token);
  },

  /** A new claim; `key` makes a retry of the same claim answer the first one instead of sending another. */
  createWarrantyClaim(token: string, projectId: string | null | undefined, claim: WarrantyClaimInput, key: string) {
    return request<{ claimId: string; number: number }>(forProject("/api/mobile/warranty", projectId), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(claim),
    });
  },

  /** One photo of a claim (one request each: the server takes at most 4.5 MB a request); slow networks get longer. */
  addWarrantyPhoto(token: string, claimId: string, photo: { uri: string; name: string; type: string }, key: string) {
    const form = new FormData();
    // React Native's FormData sends the file at `uri`.
    form.append("file", photo as unknown as Blob);
    return request<{ photoId: string }>(
      `/api/mobile/warranty/${encodeURIComponent(claimId)}/photos`,
      { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": key }, body: form },
      DOWNLOAD_TIMEOUT_MS,
    );
  },

  cancelWarrantyClaim(token: string, claimId: string) {
    return authed<{ claimId: string }>(`/api/mobile/warranty/${encodeURIComponent(claimId)}/cancel`, token, "POST");
  },

  /** A claim's photo (or its thumbnail); load it with the same Bearer token. */
  warrantyPhotoUrl(claimId: string, photoId: string, size: PhotoSize = "full") {
    return `${API_BASE}/api/mobile/warranty/${encodeURIComponent(claimId)}/photos/${encodeURIComponent(photoId)}${photoSizeQuery(size)}`;
  },
};
