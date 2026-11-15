import { auth } from "./auth";
import { NextResponse, type NextRequest } from "next/server";
import { SCRIPT_POLICY_HEADER, pagePolicy } from "./lib/security-headers.js";

/** 128 random bits, base64: a fresh one for every page request. */
function newNonce() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/**
 * Every page gets its script policy with a nonce of its own
 * (lib/security-headers.js). Next reads the nonce from the same header on the
 * request (`content-security-policy`, else `-report-only`) and puts it on its
 * scripts. A policy header the caller sent is dropped, so the nonce is always
 * this one.
 */
function withScriptPolicy(request: NextRequest) {
  // Set by Next itself (`next dev`), not a build input.
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const policy = pagePolicy(newNonce(), { dev: process.env.NODE_ENV === "development" });
  const headers = new Headers(request.headers);
  headers.delete("content-security-policy");
  headers.delete("content-security-policy-report-only");
  headers.set(SCRIPT_POLICY_HEADER, policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(SCRIPT_POLICY_HEADER, policy);
  return response;
}

export default auth(withScriptPolicy);

export const config = {
  matcher: [
    // .well-known/workflow: the Workflow SDK's own routes (the budget's AI run).
    // api/health: the uptime check, which has no session (app/api/health/route.ts).
    // api/csp-report: browsers report policy violations there, without a session.
    "/((?!api/auth|api/mobile|api/v1|api/health$|api/csp-report$|_next/static|_next/image|_vercel|\\.well-known/workflow/|favicon\\.ico).*)",
  ],
};
