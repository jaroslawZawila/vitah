import bcrypt from "bcryptjs";
const { hash } = bcrypt;
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "./schema";
import { seedConfig, seedPassword } from "./seed-config";

async function seed() {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error("POSTGRES_URL environment variable is not set");
  }

  const password = seedPassword(connectionString);
  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  const { tenantName, tenantSlug, email, projectRef } = seedConfig();
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
  // The plot and promoter of the Caviedes budget core's seed gives it
  // (seed/caviedes.ts), so the project and its budget name the same client and address.

  const [project] = await db
    .insert(schema.projects)
    .values({
      tenantId,
      ref: projectRef,
      address: "Polígono 501, Parcela 104, Caviedes-Corrales, 39592 Valdáliga (Cantabria)",
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
    .values({ tenantId, email: clientEmail, name: "Fernando Barcenilla", passwordHash, role: "client" })
    .onConflictDoNothing()
    .returning({ id: schema.users.id });

  if (demoClient) {
    await db.insert(schema.clientProfiles).values({
      userId: demoClient.id,
      tenantId,
      firstName: "Fernando",
      surnames: "Barcenilla",
      address: "Polígono 501, Parcela 104, Caviedes-Corrales, 39592 Valdáliga (Cantabria)",
      phone: "+34 600 000 000",
    });
    await db
      .update(schema.projects)
      .set({ clientUserId: demoClient.id })
      // The live one: a deleted project keeps its ref.
      .where(and(eq(schema.projects.tenantId, tenantId), eq(schema.projects.ref, projectRef), isNull(schema.projects.deletedAt)));
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
