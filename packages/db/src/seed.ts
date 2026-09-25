import bcrypt from "bcryptjs";
const { hash } = bcrypt;
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import * as schema from "./schema";

async function seed() {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error("POSTGRES_URL environment variable is not set");
  }

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  const tenantName = process.env.SEED_TENANT_NAME ?? "ViTAH Santander";
  const tenantSlug = tenantName.toLowerCase().replace(/\s+/g, "-");
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@vitah.es";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "vitah2026";
  const name = process.env.SEED_ADMIN_NAME ?? "ViTAH Admin";

  // Create or find tenant
  const [insertedTenant] = await db
    .insert(schema.tenants)
    .values({ name: tenantName, slug: tenantSlug })
    .onConflictDoNothing({ target: schema.tenants.slug })
    .returning({ id: schema.tenants.id });

  let tenantId: string;
  if (insertedTenant) {
    tenantId = insertedTenant.id;
    console.log(`Created tenant "${tenantName}"`);
  } else {
    // Tenant already exists — look it up
    const existing = await db.query.tenants.findFirst({
      where: (t, { eq }) => eq(t.slug, tenantSlug),
      columns: { id: true },
    });
    if (!existing) {
      console.error("Could not find existing tenant");
      await client.end();
      process.exit(1);
    }
    tenantId = existing.id;
    console.log(`Tenant "${tenantName}" already exists, continuing...`);
  }

  // Create admin user (no-op if it exists)
  const passwordHash = await hash(password, 12);

  await db
    .insert(schema.users)
    .values({
      tenantId: tenantId,
      email,
      name,
      passwordHash,
      role: "admin",
      active: true,
    })
    .onConflictDoNothing();

  console.log(`Admin user: ${email}`);

  // --- Seed a project ---

  const projectRef = "VTH-26-001";
  const [project] = await db
    .insert(schema.projects)
    .values({
      tenantId,
      ref: projectRef,
      address: "Calle Castelar 12, 39004 Santander",
      startDate: new Date("2026-03-10"),
      completionDate: new Date("2027-01-15"),
    })
    .onConflictDoNothing()
    .returning({ id: schema.projects.id });
  if (project) console.log(`Seeded project ${projectRef}`);

  // --- Seed a mobile app client for VTH-26-001 (same password as the admin) ---

  const clientEmail = "cliente@vitah.es";
  const [demoClient] = await db
    .insert(schema.users)
    .values({ tenantId, email: clientEmail, name: "Cliente Demo", passwordHash, role: "client" })
    .onConflictDoNothing()
    .returning({ id: schema.users.id });

  if (demoClient) {
    await db.insert(schema.clientProfiles).values({
      userId: demoClient.id,
      tenantId,
      firstName: "Cliente",
      surnames: "Demo",
      address: "Calle Castelar 12, 39004 Santander",
      phone: "+34 600 000 000",
    });
    await db
      .update(schema.projects)
      .set({ clientUserId: demoClient.id })
      .where(and(eq(schema.projects.tenantId, tenantId), eq(schema.projects.ref, projectRef)));
    console.log(`Mobile app client: ${clientEmail} (project ${projectRef})`);
  }

  console.log("Seed completed successfully!");
  await client.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
