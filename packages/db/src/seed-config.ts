/** What `pnpm db:seed` creates, shared by this package's seed and @repo/core's obra seed. */
export function seedConfig() {
  const tenantName = process.env.SEED_TENANT_NAME ?? "ViTAH Santander";
  return {
    tenantName,
    tenantSlug: tenantName.toLowerCase().replace(/\s+/g, "-"),
    email: process.env.SEED_ADMIN_EMAIL ?? "admin@vitah.es",
    projectRef: "VTH-26-001",
  };
}
