import { NextResponse } from "next/server";
import { verifyCredentials } from "@repo/auth/credentials";
import { createMobileToken } from "@repo/auth/mobile";
import type { MobileSession } from "@repo/core/contract";

// ─── POST /api/mobile/auth ────────────────────────────────────────────────────
// Credentials auth for the mobile app (client users only). Returns a signed
// JWT (30d) + user data.
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

  const user = await verifyCredentials(email, password, "mobile");
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
