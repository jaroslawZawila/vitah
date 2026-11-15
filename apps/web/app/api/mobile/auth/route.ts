import { attemptSignIn, clientIp } from "@repo/auth/credentials";
import { createMobileToken } from "@repo/auth/mobile";
import { mobileCredentials } from "@repo/core";
import type { MobileSession } from "@repo/core/contract";
import { apiJson } from "../../../../lib/responses";

// ─── POST /api/mobile/auth ────────────────────────────────────────────────────
// Credentials auth for the mobile app (client users only). Returns a signed
// JWT (30d) + user data. Throttled like the portal's sign-in (the scheme is in
// @repo/core/throttle): too many failures from the caller's IP, for the email
// or altogether, answer 429 { error: "too_many_attempts" } for a while;
// failures from elsewhere never refuse the right password.
// For social login, add POST /api/mobile/auth/social — same response shape.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiJson({ error: "invalid_body" }, { status: 400 });
  }
  const credentials = mobileCredentials(body);
  if (!credentials) return apiJson({ error: "invalid_body" }, { status: 400 });
  const { email, password } = credentials;

  if (!email || !password) {
    return apiJson(
      { error: "email_and_password_required" },
      { status: 400 }
    );
  }

  const user = await attemptSignIn(email, password, "mobile", clientIp(request));
  if (user === "too_many_attempts") {
    return apiJson({ error: user }, { status: 429 });
  }
  if (!user) {
    return apiJson({ error: "invalid_credentials" }, { status: 401 });
  }

  const token = await createMobileToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
  });

  return apiJson({ token, user } satisfies MobileSession);
}
