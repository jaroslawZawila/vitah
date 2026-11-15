import { clientIp } from "@repo/auth/credentials";
import { clientAccountService } from "@repo/core";
import { authenticateMobileRequest } from "@repo/auth/mobile";
import { apiJson, noContent } from "../../../../lib/responses";
import { logError, scrub } from "../../../../lib/log";
import { perIpLimiter, readCapped } from "../../../../lib/public-report";

// ─── POST /api/mobile/client-error ────────────────────────────────────────────
// The mobile app reports a crash or an uncaught error here, so a bug in a store
// build shows in the portal's logs. Body (JSON): { message, stack?, screen?,
// fatal?, appVersion?, platform?, osVersion?, locale? }; anything else is
// dropped. Works signed out too (a crash on the sign-in screen, an expired
// session): a valid Bearer token only adds who it happened to.
//
// It writes ONE log line (event "mobile.client_error") and stores nothing.
// Answers 204 whatever happened to the report, also when it was rate-limited;
// 413 for a body over MAX_BODY_BYTES, 400 for one that isn't a report.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 8 * 1024;
const MAX_STACK_LINES = 12;

/** The longest each text field may be; longer ones are cut. */
const TEXT_LIMITS = {
  message: 500,
  stack: 2000,
  screen: 120,
  appVersion: 40,
  platform: 20,
  osVersion: 40,
  locale: 20,
} as const;

type ClientError = { -readonly [K in keyof typeof TEXT_LIMITS]?: string } & { fatal: boolean };

/** What the shared logger keeps of a text field (`MAX_TEXT` in @repo/core/log): a longer one is cut. */
const LOG_TEXT = 500;

/**
 * The stack as the log line carries it. The logger keeps `LOG_TEXT` characters
 * of a field, less than the stack this route accepts: a short one is `stack`
 * as sent; a longer one goes on, whole lines at a time, in `stack2`, `stack3`…
 */
function stackFields(stack: string | undefined): Record<string, string> {
  const parts: string[] = [];
  for (const line of (stack ?? "").split("\n").map((l) => l.slice(0, LOG_TEXT))) {
    const last = parts.at(-1);
    if (last !== undefined && last.length + 1 + line.length <= LOG_TEXT) parts[parts.length - 1] = `${last}\n${line}`;
    else parts.push(line);
  }
  return Object.fromEntries(parts.filter(Boolean).map((part, i) => [i === 0 ? "stack" : `stack${i + 1}`, part]));
}

/**
 * The one place the event is written: one line of the portal's shared logger
 * (lib/log.ts), which cuts e-mail addresses, tokens and query strings out of
 * every text and drops any field named like a secret.
 */
function logClientError({ stack, ...fields }: ClientError & { authenticated: boolean; userId?: string; tenantId?: string }) {
  logError("mobile.client_error", undefined, { ...fields, ...stackFields(stack) });
}

// ─── Rate limit ───────────────────────────────────────────────────────────────
// 10 a minute per IP, 300 a minute per instance (lib/public-report.ts).

const allowed = perIpLimiter({ windowMs: 60_000, perIp: 10, all: 300 });

// ─── Body ─────────────────────────────────────────────────────────────────────

/** The report's known fields, cut to size; null unless it at least says what failed. */
function parseReport(text: string): ClientError | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const input = clientAccountService.readErrorReport(body);

  const report: ClientError = { fatal: input.fatal };
  for (const [field, max] of Object.entries(TEXT_LIMITS) as [keyof typeof TEXT_LIMITS, number][]) {
    const value = input[field];
    if (value === undefined) continue;
    // An error message may quote what the app was handling. The shared logger's
    // `scrub` takes e-mails and session tokens out of every text it writes; it
    // is run here too, before the cut, so a cut never leaves half of one behind
    // (the stack a line at a time: `scrub` keeps `LOG_TEXT` characters of a text).
    const clean = field === "stack" ? value.split("\n").slice(0, MAX_STACK_LINES).map(scrub).join("\n") : scrub(value);
    report[field] = clean.slice(0, max);
  }
  return report.message ? report : null;
}

export async function POST(request: Request) {
  if (!allowed(clientIp(request))) return noContent();

  const text = await readCapped(request, MAX_BODY_BYTES).catch(() => "");
  if (text === null) return apiJson({ error: "body_too_large" }, { status: 413 });
  const report = parseReport(text);
  if (!report) return apiJson({ error: "invalid_body" }, { status: 400 });

  // Who it happened to, when the phone is signed in. A missing, expired or
  // revoked token (or a database that is down) must not lose the report.
  const client = request.headers.has("authorization")
    ? await authenticateMobileRequest(request).catch(() => null)
    : null;

  logClientError({
    ...report,
    authenticated: !!client,
    ...(client ? { userId: client.sub, tenantId: client.tenantId } : {}),
  });
  return noContent();
}
