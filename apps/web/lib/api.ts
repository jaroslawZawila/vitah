import { NextResponse } from "next/server";
import { CoreError, type Ctx } from "@repo/core";
import { getRequestContext } from "@repo/auth/context";

// Shared plumbing for /api/v1 route handlers: resolve the caller, run the
// core function, and map errors to JSON `{ error: code }` responses.

export async function withContext(
  request: Request,
  handler: (ctx: Ctx) => Promise<unknown>,
  successStatus = 200,
) {
  const ctx = await getRequestContext(request);
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const data = await handler(ctx);
    if (successStatus === 204) return new NextResponse(null, { status: 204 });
    return NextResponse.json(data, { status: successStatus });
  } catch (err) {
    if (err instanceof CoreError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new CoreError("invalid_body", 400);
}
