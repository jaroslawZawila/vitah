import type { Instrumentation } from "next";
import { logError } from "@repo/core/log";

// The portal's server logging: the shared logger of @repo/core/log (one JSON
// line per event on stderr, secrets and personal data left out), plus what
// only the web app needs.

export { logError, logWarn, scrub } from "@repo/core/log";

/** A short id for one failure: logged with it and shown to whoever met it, to quote to support. */
export const newErrorId = () => crypto.randomUUID().slice(0, 8);

/**
 * An unhandled server error, as Next reports it (`onRequestError` in
 * instrumentation.ts): its digest (what the error page shows), the method,
 * the path without its query string, and which route and kind of work
 * (render, route, action, proxy) it was. Never the request's headers.
 */
export const logRequestError: Instrumentation.onRequestError = (error, request, context) => {
  logError("request.error", error, {
    digest: (error as { digest?: unknown }).digest,
    method: request.method,
    path: request.path.split("?")[0],
    routeType: context.routeType,
    routePath: context.routePath,
    router: context.routerKind,
  });
};
