// Vitest options for packages that run integration tests against a real,
// disposable PostgreSQL database. Kept free of database imports so config
// files can load it before POSTGRES_URL is set.

import { fileURLToPath } from "node:url";

/**
 * Points POSTGRES_URL at `<name>` (recreated on every run) and returns the
 * matching Vitest `test` options. Use a distinct name per package so parallel
 * test runs don't share a database.
 */
export function testDatabase(name: `${string}_test`) {
  const base = process.env.TEST_POSTGRES_URL ?? "postgres://vitah:vitah_dev@localhost:4432";
  process.env.POSTGRES_URL = `${base}/${name}`;
  // Low bcrypt cost keeps password hashing fast in tests.
  process.env.BCRYPT_COST = "4";

  return {
    globalSetup: [fileURLToPath(new URL("./test-global-setup.ts", import.meta.url))],
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
  };
}
