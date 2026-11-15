// The portal's security headers, in one place: next.config.js sends the fixed
// ones, proxy.ts the pages' script policy (a nonce per request), lib/api.ts
// and the few routes that answer by themselves the policy of what they answer
// (JSON, a file). Plain JS so next.config.js can import it.
//
//   every response (pages and /api)  BASE_HEADERS
//   pages                            + X-Frame-Options, PAGE_CSP (enforced)
//                                    + pagePolicy(nonce) (report-only: SCRIPT_POLICY_HEADER)
//   /api JSON                        + JSON_CSP
//   /api/auth's own HTML pages       + API_PAGE_CSP
//   /api files: PDFs                 + PDF_CSP, X-Frame-Options SAMEORIGIN
//   /api files: photos, ZIP…         + FILE_CSP, X-Frame-Options SAMEORIGIN
//
// Never set one of these on an /api response through next.config.js too: a
// header next.config.js sets wins over the route's own (Next keeps the first).

/** Sent with every response, the API's included. */
export const BASE_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

/**
 * Whether the pages' script policy (pagePolicy) is enforced. While false it is
 * sent as `Content-Security-Policy-Report-Only`: browsers report what it would
 * block (POST /api/csp-report, logged as `csp.violation`) and block nothing,
 * and PAGE_CSP below is what they enforce. Set it to true once the reports
 * stay quiet: the page policy is then enforced, and it carries PAGE_CSP's
 * rules too, so next.config.js stops sending PAGE_CSP by itself.
 */
export const ENFORCE_SCRIPT_POLICY = false;

export const SCRIPT_POLICY_HEADER = ENFORCE_SCRIPT_POLICY
  ? "Content-Security-Policy"
  : "Content-Security-Policy-Report-Only";

/**
 * What the pages enforce today, whatever the scripts: no framing
 * (clickjacking), no plugins, no <base> hijacking, no form posting elsewhere.
 */
const PAGE_RULES = ["frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"];

/** PAGE_RULES as one policy. */
export const PAGE_CSP = PAGE_RULES.join("; ");

/**
 * Where browsers send what the page policy blocked or would block
 * (app/api/csp-report/route.ts, which also reads the Reporting API's format).
 * Only `report-uri`: Chrome ignores it once the policy names a `report-to`
 * group, and a headless Chrome never delivered a `report-to` report in testing
 * (http://localhost, 150 s), while `report-uri` arrives at once. Add
 * `report-to` (with a `Reporting-Endpoints` header) once it is seen to arrive
 * from the deployed site.
 */
export const CSP_REPORT_PATH = "/api/csp-report";

/** Sent with every page by next.config.js; the CSP only while the script policy is report-only. */
export const PAGE_HEADERS = [
  ...BASE_HEADERS,
  { key: "X-Frame-Options", value: "DENY" },
  ...(ENFORCE_SCRIPT_POLICY ? [] : [{ key: "Content-Security-Policy", value: PAGE_CSP }]),
];

/**
 * The pages' full policy for one request. Scripts run only with this
 * request's nonce, or when loaded by one that has it (`'strict-dynamic'`:
 * Next's chunks); Next puts the nonce on its own scripts by itself (it reads
 * it from this header on the request, see proxy.ts). The rest is what the
 * portal really loads: its own files, styles and fonts (next/font serves
 * Google's from here), images from its API (photos), data:/blob: images (CSS
 * icons, previews), its PDFs in a same-origin frame, and the budget inputs
 * uploaded from the browser straight to Vercel Blob (`@vercel/blob/client`
 * talks to https://vercel.com/api/blob).
 *
 * Inline `style` attributes (computed widths) are allowed; <style> elements
 * need the nonce. Development adds what Next's dev server needs (`eval` for
 * React's debugging, inline <style> for the error overlay); production never
 * gets `'unsafe-eval'`.
 *
 * @param {string} nonce
 * @param {{ dev?: boolean }} [options]
 */
export function pagePolicy(nonce, { dev = false } = {}) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Browsers without the -elem/-attr split (before 2022) fall back to style-src.
    "style-src 'self' 'unsafe-inline'",
    dev ? "style-src-elem 'self' 'unsafe-inline'" : `style-src-elem 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://vercel.com",
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...PAGE_RULES,
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}

/**
 * A JSON answer of the API: nothing in it may load or run anything, nor be
 * framed, should a browser ever render it.
 */
export const JSON_CSP = "default-src 'none'; frame-ancestors 'none'";

/**
 * A file the API streams that is not a PDF (a photo, its thumbnail, a ZIP):
 * the browser shows an image itself or saves the file, so it may load
 * nothing, and only the portal may frame it. Checked in Chrome (a photo at the
 * top, a download).
 */
export const FILE_CSP = "default-src 'none'; frame-ancestors 'self'";

/**
 * A PDF: only who may frame it (the portal, for the budget's PDF view). The
 * browser's own PDF viewer runs inside the PDF's document, and a `default-src`
 * (so `object-src`, `script-src`, `style-src`) there has broken the viewers of
 * Safari, iOS and Firefox; `sandbox` too. Checked with this one in Chrome and
 * Firefox 158 (at the top and in a same-origin frame); Safari could not be.
 */
export const PDF_CSP = "frame-ancestors 'self'";

/**
 * A plain HTML page an API route renders by itself (Auth.js's built-in error
 * and sign-out pages under /api/auth): its inline styles and its form to
 * itself, nothing else.
 */
export const API_PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

/** The headers a JSON answer of the API adds to BASE_HEADERS. */
export const JSON_HEADERS = { "Content-Security-Policy": JSON_CSP };

/**
 * The headers a file answer of the API adds to BASE_HEADERS, by its type: a
 * PDF's policy leaves its viewer alone (PDF_CSP), anything else loads nothing
 * (FILE_CSP). Both refuse framing by another site.
 *
 * @param {string} contentType
 */
export function fileHeaders(contentType) {
  const pdf = contentType.split(";")[0].trim().toLowerCase() === "application/pdf";
  return {
    "Content-Security-Policy": pdf ? PDF_CSP : FILE_CSP,
    "X-Frame-Options": "SAMEORIGIN",
    "X-Content-Type-Options": "nosniff",
  };
}
