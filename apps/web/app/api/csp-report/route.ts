import { clientIp } from "@repo/auth/credentials";
import { logWarn } from "../../../lib/log";
import { perIpLimiter, readCapped } from "../../../lib/public-report";
import { noContent } from "../../../lib/responses";

// ─── POST /api/csp-report ─────────────────────────────────────────────────────
// Browsers report here what the pages' content policy blocked, or would block
// while it is report-only (lib/security-headers.js, `report-uri`). No session
// (proxy.ts lets it through): browsers send reports without cookies, and
// anyone can post one.
//
// Both formats browsers send: `application/csp-report` (one violation,
// `{ "csp-report": { … } }`, what `report-uri` sends) and the Reporting API's
// `application/reports+json` (a list of reports, `{ type: "csp-violation",
// body: { … } }` each, what `report-to` would send).
//
// Each violation is ONE log line (warn, event "csp.violation") with only the
// directive it broke (a known name), what was blocked reduced to its origin
// (at most 100 characters) or a known keyword or scheme (`inline`, `eval`,
// `data`, `extension`…) and the page's path without its query string;
// never the rest of the report (the page's full URL, the policy, a sample of
// the code), a cookie or a header. Nothing is stored. Always 204, whatever
// happened to the report.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 16 * 1024;
/** The most violations one request may log (a Reporting API batch); identical ones count once. */
const MAX_PER_REQUEST = 5;

const allowed = perIpLimiter({ windowMs: 60_000, perIp: 20, all: 300 });

type Violation = { directive: string; blocked: string; path?: string };

// What a report says is the sender's to choose: only names from these lists,
// and short origins, reach the log; anything else is `other` (`unknown` when
// it says nothing usable).

/** The directives a policy can break (CSP Level 3, and older ones browsers still report). */
const DIRECTIVES = new Set([
  "default-src", "child-src", "connect-src", "fenced-frame-src", "font-src", "frame-src", "img-src", "manifest-src",
  "media-src", "object-src", "prefetch-src", "script-src", "script-src-elem", "script-src-attr", "style-src",
  "style-src-elem", "style-src-attr", "worker-src", "base-uri", "sandbox", "form-action", "frame-ancestors",
  "navigate-to", "require-trusted-types-for", "trusted-types", "upgrade-insecure-requests", "block-all-mixed-content",
  "plugin-types", "webrtc",
]);

/** What browsers write instead of a URL. */
const KEYWORDS = new Set(["inline", "eval", "wasm-eval", "self", "trusted-types-policy", "trusted-types-sink"]);

/** Schemes logged as they are; any other but the web's own is `other`. */
const SCHEMES = new Set(["data", "blob", "about", "filesystem"]);

/** Browser extensions' schemes, logged as one word: which extension is the user's business. */
const EXTENSION_SCHEMES = new Set(["chrome-extension", "moz-extension", "safari-extension", "safari-web-extension", "ms-browser-extension", "extension"]);

/** The longest origin logged; a longer one is `unknown`. */
const MAX_ORIGIN = 100;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The directive's name (`script-src-elem`); Firefox's legacy reports give it with its sources. */
function directiveOf(value: unknown) {
  const name = text(value).split(/\s/)[0]!.toLowerCase();
  if (!name) return "unknown";
  return DIRECTIVES.has(name) ? name : "other";
}

/** A web URL's origin, a known scheme (`data`, `blob`, `extension`…), or the browser's keyword (`inline`, `eval`…). */
function blockedOf(value: unknown) {
  const raw = text(value);
  if (!raw) return "unknown";
  const keyword = raw.toLowerCase();
  if (KEYWORDS.has(keyword) || SCHEMES.has(keyword)) return keyword;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "other";
  }
  const scheme = url.protocol.slice(0, -1);
  if (/^(https?|wss?)$/.test(scheme)) return url.origin.length <= MAX_ORIGIN ? url.origin : "unknown";
  if (SCHEMES.has(scheme)) return scheme;
  return EXTENSION_SCHEMES.has(scheme) ? "extension" : "other";
}

/** The page's path, without its query string or fragment (none for `about:blank` and the like). */
function pathOf(value: unknown) {
  try {
    const url = new URL(text(value));
    return /^https?:$/.test(url.protocol) ? url.pathname.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

function violation(effective: unknown, violated: unknown, blocked: unknown, documentUrl: unknown): Violation {
  const path = pathOf(documentUrl);
  return {
    directive: directiveOf(text(effective) || violated),
    blocked: blockedOf(blocked),
    ...(path ? { path } : {}),
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** The violations a body reports, in either format; none for anything else. */
function violationsOf(body: unknown): Violation[] {
  // application/csp-report
  if (isObject(body) && isObject(body["csp-report"])) {
    const r = body["csp-report"];
    return [violation(r["effective-directive"], r["violated-directive"], r["blocked-uri"], r["document-uri"])];
  }
  // application/reports+json
  if (Array.isArray(body)) {
    return body
      .filter((report) => isObject(report) && report.type === "csp-violation" && isObject(report.body))
      .map((report) => {
        const r = (report as { body: Record<string, unknown> }).body;
        return violation(r.effectiveDirective, r.violatedDirective, r.blockedURL, r.documentURL);
      });
  }
  return [];
}

function parse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!allowed(clientIp(request))) return noContent();

  const body = await readCapped(request, MAX_BODY_BYTES).catch(() => null);
  if (!body) return noContent();

  const seen = new Set<string>();
  for (const found of violationsOf(parse(body))) {
    const key = JSON.stringify(found);
    if (seen.has(key)) continue;
    seen.add(key);
    logWarn("csp.violation", undefined, found);
    if (seen.size === MAX_PER_REQUEST) break;
  }
  return noContent();
}
