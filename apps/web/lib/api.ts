import { NextResponse } from "next/server";
import { CoreError, type Ctx, type StoredFile } from "@repo/core";
import { getRequestContext } from "@repo/auth/context";
import { authenticateMobileRequest, type MobileTokenPayload } from "@repo/auth/mobile";

// Shared plumbing for /api route handlers: resolve the caller, run the core
// function, and map errors to JSON `{ error: code }` responses. A handler may
// also return a ready-made `Response` (e.g. a file download).

const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

async function respond(handler: () => Promise<unknown>, successStatus: number) {
  try {
    const data = await handler();
    if (data instanceof Response) return data;
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

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Bearer calls authenticate by token (see getRequestContext); all others by cookie. */
const isBearer = (request: Request) =>
  request.headers.get("authorization")?.toLowerCase().startsWith("bearer ") ?? false;

/**
 * CSRF guard for cookie-authenticated changes: a browser always sends
 * `Origin` on a cross-origin POST/PUT/PATCH/DELETE, so one that isn't this
 * host is another site riding the staff member's session. Bearer requests
 * carry no ambient credentials and don't need it.
 */
export function isCrossSiteWrite(request: Request) {
  if (SAFE_METHODS.has(request.method) || isBearer(request)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** /api/v1: staff, via Bearer token or session cookie. */
export async function withContext(
  request: Request,
  handler: (ctx: Ctx) => Promise<unknown>,
  successStatus = 200,
) {
  if (isCrossSiteWrite(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  return respond(() => handler(ctx), successStatus);
}

/** /api/mobile: a signed-in, still active mobile-app client. */
export async function withMobileClient(
  request: Request,
  handler: (client: MobileTokenPayload) => Promise<unknown>,
) {
  const client = await authenticateMobileRequest(request);
  if (!client) return unauthorized();
  return respond(() => handler(client), 200);
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

export async function readForm(request: Request): Promise<Record<string, unknown>> {
  try {
    return Object.fromEntries(await request.formData());
  } catch {
    throw new CoreError("invalid_body", 400);
  }
}

/**
 * Streams a stored file to the caller. Never cached by shared caches;
 * `immutable` files (photos: new id per upload) may stay in the caller's own,
 * for a day only (the device may be shared).
 */
export function fileResponse(
  { filename, contentType, sizeBytes, body }: StoredFile,
  { immutable = false } = {},
) {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(sizeBytes),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": immutable ? "private, max-age=86400, immutable" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
