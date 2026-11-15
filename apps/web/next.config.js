import createNextIntlPlugin from "next-intl/plugin";
import { withWorkflow } from "workflow/next";
import { BASE_HEADERS, PAGE_HEADERS } from "./lib/security-headers.js";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// sharp (photo uploads, packages/core/src/photos.ts) loads libvips from
// @img/sharp-libvips-linux-x64/lib. Next's tracing keeps that package's JS
// but not the .so, so the functions crash with ERR_DLOPEN_FAILED on Vercel.
// Ship it with the routes that process uploads only: it's ~18 MB.
const LIBVIPS = [
  "../../node_modules/.pnpm/@img+sharp-libvips-linux-x64@*/node_modules/@img/sharp-libvips-linux-x64/lib/**/*",
];

/** @type {import('next').NextConfig} */
export const nextConfig = {
  poweredByHeader: false,
  async headers() {
    // lib/security-headers.js says what each kind of response gets. On /api
    // only the headers every response shares: a JSON answer and a file set
    // their own policy (lib/api.ts), and a header set here would win over it.
    return [
      { source: "/((?!api/).*)", headers: PAGE_HEADERS },
      { source: "/api/:path*", headers: BASE_HEADERS },
    ];
  },
  outputFileTracingIncludes: {
    // Portal uploads: the Photos tab's server action.
    "/dashboard/projects/*/photos": LIBVIPS,
    // POST /api/v1/projects/:id/photos
    "/api/v1/projects/*/photos": LIBVIPS,
    // The budget's AI run scales photos of plans (workflows/generate-budget.ts).
    "/.well-known/workflow/**": LIBVIPS,
  },
  experimental: {
    // Document uploads (PDF ≤ 4 MB, see MAX_DOCUMENT_BYTES) go through a
    // server action. Vercel caps function request bodies at 4.5 MB anyway.
    serverActions: { bodySizeLimit: "4.5mb" },
  },
};

// withWorkflow: the budget is drafted by a durable workflow (workflows/).
export default withWorkflow(withNextIntl(nextConfig));
