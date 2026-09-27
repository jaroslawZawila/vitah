import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// sharp (photo uploads, packages/core/src/photos.ts) loads libvips from
// @img/sharp-libvips-linux-x64/lib. Next's tracing keeps that package's JS
// but not the .so, so the functions crash with ERR_DLOPEN_FAILED on Vercel.
// Ship it with the routes that process uploads only: it's ~18 MB.
const LIBVIPS = [
  "../../node_modules/.pnpm/@img+sharp-libvips-linux-x64@*/node_modules/@img/sharp-libvips-linux-x64/lib/**/*",
];

// Sent with every page. The CSP doesn't restrict scripts (Next's inline
// bootstrap would need nonces); it stops framing (clickjacking), plugins,
// <base> hijacking and forms posting elsewhere. Not on /api: its PDFs open in
// the browser's viewer, which `object-src 'none'` and framing rules break
// (file responses set their own nosniff, see lib/api.ts).
const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/((?!api/).*)", headers: SECURITY_HEADERS }];
  },
  outputFileTracingIncludes: {
    // Portal uploads: the Photos tab's server action.
    "/dashboard/projects/*/photos": LIBVIPS,
    // POST /api/v1/projects/:id/photos
    "/api/v1/projects/*/photos": LIBVIPS,
  },
  experimental: {
    // Document uploads (PDF ≤ 4 MB, see MAX_DOCUMENT_BYTES) go through a
    // server action. Vercel caps function request bodies at 4.5 MB anyway.
    serverActions: { bodySizeLimit: "4.5mb" },
  },
};

export default withNextIntl(nextConfig);
