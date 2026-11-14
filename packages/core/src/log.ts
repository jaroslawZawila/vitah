// Server logging: one JSON line per event on stderr, which the host collects
// (Vercel keeps stdout/stderr). Provider-neutral and dependency-free, so the
// portal's instrumentation and its API wrappers share it (apps/web/lib/log.ts).
//
//   {"level":"error","time":"2026-11-14T10:02:11.482Z","event":"api.internal_error",
//    "id":"3f9c2a1b","method":"POST","path":"/api/v1/projects",
//    "error":{"name":"TypeError","message":"…","stack":["at …","at …"]}}
//
// A line never carries what identifies a person or opens a door: fields named
// like a secret are dropped, and e-mail addresses, session tokens and query
// strings are cut out of every text (an error's message included).

export type LogLevel = "error" | "warn";
export type LogFields = Record<string, unknown>;

/** A logged error: what it was and where, never the values it carried. */
export type LoggedError = { name: string; message: string; code?: string; stack?: string[]; cause?: string };

const STACK_LINES = 6;
const MAX_TEXT = 500;
/** Field names that never reach a log line, whatever they hold. */
const FORBIDDEN_FIELD = /cookie|authorization|password|passwd|secret|token|email|body|header|query|search/i;
const RESERVED = new Set(["level", "time", "event", "error"]);
/**
 * How much of a text is looked at: a log line keeps `MAX_TEXT` characters, so
 * nothing past this can reach it. Cutting first also bounds the work of the
 * patterns below, whatever is thrown at them (a megabyte without a space).
 */
const MAX_INPUT = 4_000;
/**
 * A run of the characters an address's name is made of, and the `@domain.tld`
 * after it if there is one. The run is taken whole and never retried from its
 * middle (the old `name+@domain` was, from every character of a long token:
 * quadratic), so the scan is linear however long an unbroken token is.
 */
const NAME_OR_EMAIL = /[\w.%+-]+(?:@[\w-]+(?:\.[\w-]+)+)?/g;
/** A path or URL's query string: `/a/b?x=1` → `/a/b`. */
const QUERY = /(\/[^\s?#"'()]*)\?[^\s"'()]*/g;
const NAME_CHAR = /[\w.%+-]/;
/** A signed token (a JWT: the app's session, the portal's cookie) quoted in a text. */
const TOKEN = /\beyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?/g;
/** An `Authorization` value quoted in a text, whatever kind of token follows. */
const BEARER = /\bBearer\s+[^\s"']+/gi;

/** `text` without the start of an address the cut may have left at its very end (`… ana@vit`). */
function withoutCutEmail(text: string): string {
  const at = text.lastIndexOf("@");
  if (at === -1 || !/^[\w.-]*$/.test(text.slice(at + 1))) return text;
  let start = at;
  while (start > 0 && NAME_CHAR.test(text[start - 1]!)) start--;
  return start === at ? text : `${text.slice(0, start)}[email]`;
}

/** A text safe to log: no e-mail address, no token, no query string, and not endless. */
export function scrub(text: string): string {
  // Cut before anything is matched, never after.
  const cut = text.length > MAX_INPUT;
  const head = cut ? withoutCutEmail(text.slice(0, MAX_INPUT)) : text;
  const clean = head
    .replace(BEARER, "Bearer [token]")
    .replace(TOKEN, "[token]")
    .replace(QUERY, "$1")
    .replace(NAME_OR_EMAIL, (run) => (run.includes("@") ? "[email]" : run));
  return cut || clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT)}…` : clean;
}

/** The fields a line may carry: plain values only, none named like a secret. */
function safeFields(fields: LogFields): LogFields {
  const safe: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (RESERVED.has(key) || FORBIDDEN_FIELD.test(key)) continue;
    if (typeof value === "string") safe[key] = scrub(value);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) safe[key] = value;
    else if (typeof value === "bigint") safe[key] = String(value);
    else if (value instanceof Date) safe[key] = value.toISOString();
    // Objects and lists are left out: a line stays flat, and nothing rides in unseen.
  }
  return safe;
}

/**
 * What was thrown, as text. A failed query's message ends with the values it
 * was run with (Drizzle's "Failed query: … params: …"): the statement stays,
 * the values (names, addresses, whatever a user typed) go.
 */
const messageOf = (value: unknown) => scrub((value instanceof Error ? value.message : String(value)).split(/\nparams:/)[0]!);

const codeOf = (value: unknown) => {
  const code = (value as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : undefined;
};

/** An error as a line carries it: name, message, a code if it has one and where it was thrown. */
export function describeError(error: unknown): LoggedError {
  if (!(error instanceof Error)) return { name: "NonError", message: messageOf(error) };
  // A database error keeps its code (23505…) on the cause the ORM wraps.
  const code = codeOf(error) ?? codeOf(error.cause);
  const frames = (error.stack ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .slice(0, STACK_LINES)
    // Function names and file paths, no data: kept as thrown (a package path like `next@16.2.0` is no e-mail).
    .map((line) => line.slice(0, MAX_TEXT));
  return {
    name: error.name,
    message: messageOf(error),
    ...(code === undefined ? {} : { code }),
    ...(frames.length > 0 ? { stack: frames } : {}),
    ...(error.cause === undefined ? {} : { cause: messageOf(error.cause) }),
  };
}

/** The line itself (exported for the tests): level, time, event, the fields, then the error. */
export function logLine(
  level: LogLevel,
  event: string,
  error?: unknown,
  fields: LogFields = {},
  now = new Date(),
): LogFields & { level: LogLevel; time: string; event: string; error?: LoggedError } {
  return {
    level,
    time: now.toISOString(),
    event,
    ...safeFields(fields),
    ...(error === undefined ? {} : { error: describeError(error) }),
  };
}

function write(level: LogLevel, event: string, error: unknown, fields: LogFields | undefined) {
  try {
    const line = JSON.stringify(logLine(level, event, error, fields));
    if (level === "error") console.error(line);
    else console.warn(line);
  } catch {
    // Logging never fails its caller.
  }
}

/** Logs a server error: `event` says what failed (`changes.mark_failed`), `fields` which record or request. */
export function logError(event: string, error: unknown, fields?: LogFields) {
  write("error", event, error, fields);
}

/** Logs something worth a look that failed nothing. */
export function logWarn(event: string, error?: unknown, fields?: LogFields) {
  write("warn", event, error, fields);
}
