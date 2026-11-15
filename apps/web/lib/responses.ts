import { NextResponse } from "next/server";
import type { StoredFile } from "@repo/core";
import { API_PAGE_CSP, JSON_HEADERS, fileHeaders } from "./security-headers.js";

// How the API answers, each kind with its own security headers
// (lib/security-headers.js); next.config.js adds those every response shares.
// lib/api.ts re-exports them for the route handlers.

/** A JSON answer: nothing in it may load, run or be framed. Every JSON the API sends is built here. */
export function apiJson(data: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(data, init);
  for (const [key, value] of Object.entries(JSON_HEADERS)) response.headers.set(key, value);
  return response;
}

/** An empty answer (204), with the JSON answers' policy. */
export const noContent = () => new NextResponse(null, { status: 204, headers: JSON_HEADERS });

/**
 * A route handler that builds its own answers, Auth.js's: JSON, redirects and
 * a few plain HTML pages. Each gets the JSON policy, the HTML ones the policy
 * of a page with inline styles and a form (API_PAGE_CSP). A file must never
 * go through it (fileResponse sets its own).
 */
export function withApiPolicy<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args) => {
    const response = await handler(...args);
    // Copied: a Response.redirect's headers can't be changed.
    const headers = new Headers(response.headers);
    const html = headers.get("content-type")?.startsWith("text/html");
    headers.set("Content-Security-Policy", html ? API_PAGE_CSP : JSON_HEADERS["Content-Security-Policy"]);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}

/**
 * Streams a stored file to the caller. Never cached by shared caches;
 * `immutable` files (photos: new id per upload) may stay in the caller's own,
 * for a day only (the device may be shared). A file built on the fly (no
 * `sizeBytes`, e.g. a ZIP) streams without a length; `download` saves it
 * instead of opening it. Its policy depends on its type (fileHeaders in
 * lib/security-headers.js): a PDF's leaves the browser's viewer alone,
 * anything else loads nothing; no other site may frame either.
 */
export function fileResponse(
  { filename, contentType, sizeBytes, body }: Omit<StoredFile, "sizeBytes"> & { sizeBytes?: number },
  { immutable = false, download = false } = {},
) {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      ...(sizeBytes === undefined ? {} : { "Content-Length": String(sizeBytes) }),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": immutable ? "private, max-age=86400, immutable" : "private, no-store",
      ...fileHeaders(contentType),
    },
  });
}
