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

/**
 * The seeded accounts' password: SEED_ADMIN_PASSWORD, or the documented dev
 * default only for a database on this machine. Refuses to put the public
 * default on any other database.
 */
export function seedPassword(connectionString: string, env = process.env): string {
  if (env.SEED_ADMIN_PASSWORD) return env.SEED_ADMIN_PASSWORD;
  const { hostname } = new URL(connectionString);
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) return "vitah2026";
  throw new Error(`Set SEED_ADMIN_PASSWORD to seed ${hostname}: the default password is public`);
}
