import { NextResponse } from "next/server";
import { attemptSignIn, clientIp } from "@repo/auth/credentials";
import { createMobileToken } from "@repo/auth/mobile";
import type { MobileSession } from "@repo/core/contract";

// ─── POST /api/mobile/auth ────────────────────────────────────────────────────
// Credentials auth for the mobile app (client users only). Returns a signed
// JWT (30d) + user data. Throttled: too many failures for the email or from
// the IP answer 429 { error: "too_many_attempts" } for a while.
// For social login, add POST /api/mobile/auth/social — same response shape.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  let email: string | undefined;
  let password: string | undefined;

  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    email = typeof body.email === "string" ? body.email.trim() : undefined;
    password = typeof body.password === "string" ? body.password : undefined;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json(
      { error: "email_and_password_required" },
      { status: 400 }
    );
  }

  const user = await attemptSignIn(email, password, "mobile", clientIp(request));
  if (user === "too_many_attempts") {
    return NextResponse.json({ error: user }, { status: 429 });
  }
  if (!user) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const token = await createMobileToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
  });

  return NextResponse.json({ token, user } satisfies MobileSession);
}
