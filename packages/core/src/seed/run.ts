// `pnpm db:seed` (after @repo/db's seed): gives the local dev project VTH-26-001
// the real Castrillón budget half built (./seed-obra). Skips a project that
// already has a budget. Acta and invoice PDFs need a Blob store
// (BLOB_READ_WRITE_TOKEN); without one they're left out.

import { and, budgetRevisions, db, eq, projects, seedConfig, tenants, users } from "@repo/db";
import { seedObra } from "./seed-obra";

const { tenantSlug, email, projectRef } = seedConfig();

async function run() {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.slug, tenantSlug),
    columns: { id: true },
  });
  const admin =
    tenant &&
    (await db.query.users.findFirst({
      where: and(eq(users.tenantId, tenant.id), eq(users.email, email)),
      columns: { id: true },
    }));
  const project =
    tenant &&
    (await db.query.projects.findFirst({
      where: and(eq(projects.tenantId, tenant.id), eq(projects.ref, projectRef)),
      columns: { id: true },
    }));
  if (!tenant || !admin || !project) throw new Error("Run @repo/db's seed first");

  const budget = await db.query.budgetRevisions.findFirst({
    where: eq(budgetRevisions.projectId, project.id),
    columns: { id: true },
  });
  if (budget) {
    console.log(`${projectRef} already has a budget, skipping the obra`);
    return;
  }
  const ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" } as const;
  await seedObra(ctx, project.id, { files: Boolean(process.env.BLOB_READ_WRITE_TOKEN) });
  console.log(`Seeded the obra of ${projectRef} (budget 036/2026 Rev.3)`);
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
