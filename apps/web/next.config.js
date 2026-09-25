import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Document uploads (PDF ≤ 4 MB, see MAX_DOCUMENT_BYTES) go through a
    // server action. Vercel caps function request bodies at 4.5 MB anyway.
    serverActions: { bodySizeLimit: "4.5mb" },
  },
};

export default withNextIntl(nextConfig);
