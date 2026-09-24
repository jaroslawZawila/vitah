import { NextResponse } from "next/server";
import { authenticateMobileRequest } from "@repo/auth/mobile";
import { getClientProject } from "@repo/core";

// ─── GET /api/mobile/project ──────────────────────────────────────────────────
// The project attached to the signed-in client, or { project: null } when no
// project is attached yet. Requires `Authorization: Bearer <token>`.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const client = await authenticateMobileRequest(request);
  if (!client) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const project = await getClientProject(client.tenantId, client.sub);
  return NextResponse.json({ project });
}
