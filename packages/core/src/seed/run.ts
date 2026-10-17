// `pnpm db:seed` (after @repo/db's seed): gives the local dev project VTH-26-001
// the real Caviedes budget (004/2026) part built with its construction control
// records (./seed-obra), and fictional
// subcontractors working on it (./subcontractors). Skips what is already there.
// PDFs need a Blob store (BLOB_READ_WRITE_TOKEN); without one they're left out.

import { and, budgetRevisions, db, eq, obraChapterProgress, projects, seedConfig, tenants, users } from "@repo/db";
import { seedControl, seedObra } from "./seed-obra";
import { seedSubcontractors } from "./subcontractors";

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

  const ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" } as const;
  const files = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const budget = await db.query.budgetRevisions.findFirst({
    where: eq(budgetRevisions.projectId, project.id),
    columns: { id: true },
  });
  if (budget) {
    console.log(`${projectRef} already has a budget, skipping the obra`);
  } else {
    await seedObra(ctx, project.id, { files });
    console.log(`Seeded the obra of ${projectRef} (budget 004/2026)`);
  }

  const recorded = await db.query.obraChapterProgress.findFirst({
    where: eq(obraChapterProgress.projectId, project.id),
    columns: { id: true },
  });
  if (recorded) {
    console.log(`${projectRef} already has construction control records, skipping them`);
  } else {
    await seedControl(ctx, project.id);
    console.log(`Seeded the construction control of ${projectRef}`);
  }

  const companies = await seedSubcontractors(ctx, project.id, { files });
  console.log(companies ? `Seeded ${companies} subcontractors on ${projectRef}` : "Subcontractors already seeded");
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
