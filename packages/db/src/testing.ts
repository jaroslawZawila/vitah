// Test helpers shared by every package that runs integration tests against
// a real PostgreSQL database. Not for production code.

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { db } from "./client";
import { projectDocuments, projects, tenants, users, type UserRole } from "./schema";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Drops and recreates the database named in `url`, then pushes the current
 * schema to it. Call from a Vitest `globalSetup`.
 */
export async function recreateTestDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  if (!/^[a-z0-9_]+_test[a-z0-9_]*$/.test(dbName)) {
    throw new Error(`Refusing to recreate non-test database "${dbName}"`);
  }

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    await client.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await client.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }

  const drizzleKit = resolve(packageRoot, "node_modules/.bin/drizzle-kit");
  execFileSync(drizzleKit, ["push", "--force"], {
    cwd: packageRoot,
    env: { ...process.env, POSTGRES_URL: url },
    stdio: "pipe",
  });
}

/** Removes all rows. Every table cascades from `tenants`. */
export async function resetDatabase(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE tenants CASCADE`);
}

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function createTestTenant(overrides: { active?: boolean } = {}) {
  const suffix = unique();
  const [tenant] = await db
    .insert(tenants)
    .values({ name: `Tenant ${suffix}`, slug: `tenant-${suffix}`, ...overrides })
    .returning();
  return tenant!;
}

export async function createTestUser(
  tenantId: string,
  overrides: {
    email?: string;
    name?: string;
    password?: string;
    role?: UserRole;
    active?: boolean;
  } = {},
) {
  const { password = "password123", ...rest } = overrides;
  const [user] = await db
    .insert(users)
    .values({
      tenantId,
      email: `user-${unique()}@example.com`,
      name: "Test User",
      role: "viewer",
      ...rest,
      // Low cost keeps tests fast; production code uses 12.
      passwordHash: await bcrypt.hash(password, 4),
    })
    .returning();
  return user!;
}

export async function createTestProject(
  tenantId: string,
  overrides: Partial<typeof projects.$inferInsert> = {},
) {
  const [project] = await db
    .insert(projects)
    .values({
      tenantId,
      ref: `VTH-${unique()}`,
      address: "Calle Mayor 1, Santander",
      ...overrides,
    })
    .returning();
  return project!;
}

export async function createTestDocument(
  tenantId: string,
  projectId: string,
  overrides: Partial<typeof projectDocuments.$inferInsert> = {},
) {
  const [document] = await db
    .insert(projectDocuments)
    .values({
      tenantId,
      projectId,
      title: "Contrato de obra",
      category: "contract",
      pathname: `tenants/${tenantId}/projects/${projectId}/${unique()}.pdf`,
      sizeBytes: 1024,
      ...overrides,
    })
    .returning();
  return document!;
}
