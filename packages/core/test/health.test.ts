import { beforeEach, describe, expect, it } from "vitest";
import {
  aiUsage,
  budgetGenerations,
  db,
  eq,
  projects,
  purchaseDocumentChecks,
  purchaseOrderDocuments,
  purchaseOrderDocumentVersions,
  purchaseOrders,
  sql,
  subcontractors,
  tenants,
} from "@repo/db";
import { createTestProject, createTestTenant, resetDatabase } from "@repo/db/testing";
import { healthService as svc } from "../src";

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms);

async function setup() {
  const tenant = await createTestTenant();
  const project = await createTestProject(tenant.id, { ref: "VTH-SECRET-REF", address: "Calle Secreta 7" });
  return { tenant, project };
}

/** A budget generation in `status`, last touched `updatedAt`. */
async function generation(tenantId: string, projectId: string, status: "succeeded" | "failed" | "running", updatedAt = new Date()) {
  const [row] = await db
    .insert(budgetGenerations)
    .values({ tenantId, projectId, status, options: {}, documentIds: [] })
    .returning({ id: budgetGenerations.id });
  // Raw: the column stamps itself on every ORM update.
  await db.execute(sql`update budget_generations set updated_at = ${updatedAt.toISOString()}::timestamp where id = ${row!.id}`);
}

let orders = 0;

/** A purchase document's check in `status`, queued `createdAt`. */
async function check(tenantId: string, projectId: string, status: "pending" | "running" | "done" | "failed", createdAt = new Date()) {
  const [supplier] = await db
    .insert(subcontractors)
    .values({
      tenantId,
      kind: "company",
      legalName: "Piedra de Liébana S.L.",
      taxId: `B${Math.random().toString().slice(2, 10)}`,
      address: "Barrio La Serna 7",
      postalCode: "39570",
      city: "Potes",
      province: "Cantabria",
      reaRegion: "cb",
      suppliesOnly: true,
    })
    .returning({ id: subcontractors.id });
  const [order] = await db
    .insert(purchaseOrders)
    .values({ tenantId, projectId, number: ++orders, kind: "material", subcontractorId: supplier!.id, description: "Piedra" })
    .returning({ id: purchaseOrders.id });
  // The order's PDF, the file a check reviews.
  const [document] = await db
    .insert(purchaseOrderDocuments)
    .values({ tenantId, orderId: order!.id, title: "Pedido" })
    .returning({ id: purchaseOrderDocuments.id });
  const [version] = await db
    .insert(purchaseOrderDocumentVersions)
    .values({ tenantId, documentId: document!.id, version: 1, pathname: `orders/${order!.id}/v1.pdf`, filename: "x.pdf", sizeBytes: 100 })
    .returning({ id: purchaseOrderDocumentVersions.id });
  await db
    .insert(purchaseDocumentChecks)
    .values({ tenantId, orderId: order!.id, documentVersionId: version!.id, pathname: "x.pdf", label: "Pedido · v1", status, createdAt });
}

const limit = (tenantId: string, cents: number | null) => db.update(tenants).set({ aiMonthlyLimitCents: cents }).where(eq(tenants.id, tenantId));

/** `cents` of AI spend by the tenant, this month unless `createdAt` says otherwise. */
const spend = (tenantId: string, cents: number, createdAt = new Date()) =>
  db.insert(aiUsage).values({ tenantId, purpose: "x", model: "m", inputTokens: 1, outputTokens: 1, costMicroUsd: cents * 10_000, createdAt });

beforeEach(resetDatabase);

describe("pingDatabase", () => {
  it("resolves when the database answers", async () => {
    await expect(svc.pingDatabase()).resolves.toBeUndefined();
  });
});

describe("bounded", () => {
  it("has the database cancel a statement that takes too long, and leaves the connection as it was", async () => {
    const started = Date.now();

    const error = await svc.bounded((tx) => tx.execute(sql`select pg_sleep(10)`), 200).catch((e: unknown) => e);

    expect(Date.now() - started).toBeLessThan(5_000);
    // 57014: query_canceled, "canceling statement due to statement timeout".
    expect((error as { cause?: { code?: string } }).cause?.code).toBe("57014");
    // Nothing is left running, and the limit ended with the transaction.
    const running = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid() and state = 'active' and query like '%pg_sleep(10)%'`);
    expect(running[0]?.n).toBe(0);
    for (let i = 0; i < 12; i++) {
      const [row] = await db.execute<{ statement_timeout: string }>(sql`show statement_timeout`);
      expect(row?.statement_timeout).toBe("0");
    }
  });

  it("gives the check's answer when it is in time, under the default limit", async () => {
    const [row] = await svc.bounded((tx) => tx.execute<{ timeout: string }>(sql`select current_setting('statement_timeout') as timeout`));

    expect(row?.timeout).toBe(`${svc.HEALTH_STATEMENT_TIMEOUT_MS}ms`);
  });
});

describe("aiNeedsAttention", () => {
  it("is false on an empty system and on one where everything works", async () => {
    expect(await svc.aiNeedsAttention()).toBe(false);

    const { tenant, project } = await setup();
    await generation(tenant.id, project.id, "succeeded");
    await generation(tenant.id, project.id, "running");
    await check(tenant.id, project.id, "done", ago(5 * HOUR));
    await check(tenant.id, project.id, "failed", ago(5 * HOUR));
    await check(tenant.id, project.id, "running", ago(5 * HOUR));
    await limit(tenant.id, 1_000);
    await spend(tenant.id, 899);
    // No limit: however much it spends.
    const free = await setup();
    await spend(free.tenant.id, 1_000_000);

    expect(await svc.aiNeedsAttention()).toBe(false);
  });

  it("is true for a day after a budget generation failed", async () => {
    const { tenant, project } = await setup();
    await generation(tenant.id, project.id, "failed", ago(25 * HOUR));
    expect(await svc.aiNeedsAttention()).toBe(false);

    await generation(tenant.id, project.id, "failed", ago(23 * HOUR));
    expect(await svc.aiNeedsAttention()).toBe(true);
  });

  it("is true once a purchase document has waited over an hour for its review", async () => {
    const { tenant, project } = await setup();
    await check(tenant.id, project.id, "pending", ago(0.5 * HOUR));
    expect(await svc.aiNeedsAttention()).toBe(false);

    await check(tenant.id, project.id, "pending", ago(2 * HOUR));
    expect(await svc.aiNeedsAttention()).toBe(true);
  });

  it("leaves out a waiting check of a deleted obra: it is never reviewed", async () => {
    const { tenant, project } = await setup();
    await check(tenant.id, project.id, "pending", ago(2 * HOUR));
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, project.id));

    expect(await svc.aiNeedsAttention()).toBe(false);
  });

  it("is true when a tenant has spent 90 % of its monthly AI limit", async () => {
    const { tenant } = await setup();
    await limit(tenant.id, 1_000);
    await spend(tenant.id, 899);
    // Last year's spend is not this month's.
    await spend(tenant.id, 5_000, ago(400 * 24 * HOUR));
    expect(await svc.aiNeedsAttention()).toBe(false);

    await spend(tenant.id, 1);
    expect(await svc.aiNeedsAttention()).toBe(true);
  });

  it("counts each tenant's spend against its own limit, and a limit that no integer holds", async () => {
    const tight = await setup();
    const big = await setup();
    await limit(tight.tenant.id, 1_000);
    // 90 % of it in micro-USD is past a 32-bit integer.
    await limit(big.tenant.id, 2_000_000_000);
    await spend(big.tenant.id, 950);

    expect(await svc.aiNeedsAttention()).toBe(false);
  });

  it("ignores a limit of 0: the AI is switched off there", async () => {
    const { tenant } = await setup();
    await limit(tenant.id, 0);

    expect(await svc.aiNeedsAttention()).toBe(false);
  });

  it("answers yes or no and nothing about the tenants", async () => {
    const { tenant, project } = await setup();
    await generation(tenant.id, project.id, "failed");

    const answer = await svc.aiNeedsAttention();

    expect(answer).toBe(true);
    expect(JSON.stringify(answer)).toBe("true");
  });
});

describe("migrationsTracked", () => {
  it("says whether a schema_migrations table exists, whatever its columns", async () => {
    // The table may already be there (the migration tooling makes it): take it away and put it back.
    const present = await svc.migrationsTracked();
    const [hide, show] = present
      ? [sql`alter table schema_migrations rename to schema_migrations_parked`, sql`alter table schema_migrations_parked rename to schema_migrations`]
      : [sql`drop table schema_migrations`, sql`create table schema_migrations (anything text)`];
    if (!present) await db.execute(show);
    try {
      expect(await svc.migrationsTracked()).toBe(true);
      await db.execute(hide);
      expect(await svc.migrationsTracked()).toBe(false);
    } finally {
      if (present) await db.execute(show);
    }
  });
});
