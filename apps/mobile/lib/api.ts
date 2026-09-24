const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export type UserRole = "admin" | "manager" | "viewer";

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  tenantId: string;
};

type SignInSuccess = { token: string; user: AuthUser; error?: never };
type SignInFailure = { error: string; token?: never; user?: never };
type SignInResult = SignInSuccess | SignInFailure;

// ─── Social login (future) ────────────────────────────────────────────────────
// Add signInWithProvider(provider: 'google' | 'apple', idToken: string) here.
// Call POST /api/mobile/auth/social with { provider, idToken }.
// The server validates the idToken, looks up the user by (tenantId, email),
// and returns the same { token, user } shape — no changes needed in auth.tsx.
// ─────────────────────────────────────────────────────────────────────────────

// JSON shape of GET /api/v1/projects (see packages/core/src/projects.ts).
// Dates arrive as ISO strings; budgetTotal is in cents.
export type Project = {
  id: string;
  ref: string;
  clientName: string;
  areaM2: number;
  type: "unifamiliar" | "adosado" | "duplex";
  phase: string;
  progressPct: number;
  budgetTotal: number;
  location: string;
  expectedDeliveryDate: string | null;
  advisor: { id: string; name: string | null } | null;
};

type ApiResult<T> = { data: T; error?: never } | { error: string; data?: never };

async function authedGet<T>(path: string, token: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (!res.ok) return { error: (body.error as string) ?? "request_failed" };
    return { data: body as T };
  } catch {
    return { error: "network_error" };
  }
}

export const api = {
  getProjects(token: string) {
    return authedGet<Project[]>("/api/v1/projects", token);
  },


  async signIn(email: string, password: string): Promise<SignInResult> {
    try {
      const res = await fetch(`${API_BASE}/api/mobile/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        return { error: (data.error as string) ?? "invalid_credentials" };
      }

      return data as SignInSuccess;
    } catch {
      return { error: "network_error" };
    }
  },
};
