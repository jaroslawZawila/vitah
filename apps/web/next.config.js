import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// sharp (photo uploads, packages/core/src/photos.ts) loads libvips from
// @img/sharp-libvips-linux-x64/lib. Next's tracing keeps that package's JS
// but not the .so, so the functions crash with ERR_DLOPEN_FAILED on Vercel.
// Ship it with the routes that process uploads only: it's ~18 MB.
const LIBVIPS = [
  "../../node_modules/.pnpm/@img+sharp-libvips-linux-x64@*/node_modules/@img/sharp-libvips-linux-x64/lib/**/*",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
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
