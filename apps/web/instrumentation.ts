import type { Instrumentation } from "next";
import { logRequestError } from "./lib/log";

// Next calls this for every server error nothing handled (a page render, a
// route handler, a server action, the proxy): one JSON line on stderr, with
// the digest the error page shows the user (see lib/log.ts).
export const onRequestError: Instrumentation.onRequestError = logRequestError;
