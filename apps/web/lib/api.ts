import { NextResponse } from "next/server";
import { CoreError, type Ctx, type DocumentFile } from "@repo/core";
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

/** /api/v1: staff, via Bearer token or session cookie. */
export async function withContext(
  request: Request,
  handler: (ctx: Ctx) => Promise<unknown>,
  successStatus = 200,
) {
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

/** Streams a stored PDF to the caller. Never cached by shared caches. */
export function fileResponse({ title, sizeBytes, body }: DocumentFile) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(sizeBytes),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(`${title}.pdf`)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
