import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiUsage,
  budgetGenerations,
  db,
  eq,
  purchaseDocumentChecks,
  purchaseOrderDocuments,
  purchaseOrderDocumentVersions,
  purchaseOrders,
  subcontractors,
  tenants,
} from "@repo/db";
import { createTestProject, createTestTenant, resetDatabase } from "@repo/db/testing";
import * as health from "@repo/core/health";
import { HEALTH_DOWN_FRESH_MS, HEALTH_FRESH_MS, forgetHealth } from "../../../lib/health";
import { GET } from "./route";

// The uptime check: whether the parts work, and nothing about what is in them.
// The AI's three conditions run against the real database; the database being
// down and the migrations table are mocked (the checks are @repo/core/health's,
// tested there).

vi.mock("@repo/core/health", async (importActual) => {
  const actual = await importActual<typeof import("@repo/core/health")>();
  return { ...actual, pingDatabase: vi.fn(actual.pingDatabase), migrationsTracked: vi.fn(), aiNeedsAttention: vi.fn(actual.aiNeedsAttention) };
});

const HOUR = 3_600_000;

async function setup() {
  const tenant = await createTestTenant();
  const project = await createTestProject(tenant.id, { ref: "VTH-26-777", address: "Calle Secreta 7" });
  return { tenant, project };
}

beforeEach(async () => {
  await resetDatabase();
  forgetHealth();
  vi.mocked(health.migrationsTracked).mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  // Back to the real checks.
  vi.mocked(health.pingDatabase).mockReset();
  vi.mocked(health.aiNeedsAttention).mockReset();
});

describe("GET /api/health", () => {
  it("is ok when the database answers and nothing needs a look", async () => {
    await setup();

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(await res.json()).toEqual({
      status: "ok",
      commit: "dev",
      time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      checks: { db: "ok", ai: "ok", migrations: "ok" },
    });
  });

  it("says which commit is running, shortened", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "b98d6321c0ffee00b98d6321c0ffee00b98d6321");

    expect((await (await GET()).json()).commit).toBe("b98d632");
  });

  it("is degraded when a budget generation failed in the last day", async () => {
    const { tenant, project } = await setup();
    await db.insert(budgetGenerations).values({ tenantId: tenant.id, projectId: project.id, status: "failed", options: {}, documentIds: [] });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "degraded", checks: { db: "ok", ai: "attention", migrations: "ok" } });
  });

  it("is degraded when a purchase document has waited over an hour for its review", async () => {
    const { tenant, project } = await setup();
    const [supplier] = await db
      .insert(subcontractors)
      .values({ tenantId: tenant.id, kind: "company", legalName: "Piedra de Liébana S.L.", taxId: "B39654322", address: "La Serna 7", postalCode: "39570", city: "Potes", province: "Cantabria", reaRegion: "cb", suppliesOnly: true })
      .returning({ id: subcontractors.id });
    const [order] = await db
      .insert(purchaseOrders)
      .values({ tenantId: tenant.id, projectId: project.id, number: 1, kind: "material", subcontractorId: supplier!.id, description: "Piedra" })
      .returning({ id: purchaseOrders.id });
    // The order's PDF, the file a check reviews.
    const [document] = await db
      .insert(purchaseOrderDocuments)
      .values({ tenantId: tenant.id, orderId: order!.id, title: "Pedido" })
      .returning({ id: purchaseOrderDocuments.id });
    const [version] = await db
      .insert(purchaseOrderDocumentVersions)
      .values({ tenantId: tenant.id, documentId: document!.id, version: 1, pathname: "x.pdf", filename: "x.pdf", sizeBytes: 100 })
      .returning({ id: purchaseOrderDocumentVersions.id });
    await db.insert(purchaseDocumentChecks).values({
      tenantId: tenant.id,
      orderId: order!.id,
      documentVersionId: version!.id,
      pathname: "x.pdf",
      label: "Pedido · v1",
      createdAt: new Date(Date.now() - 2 * HOUR),
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "degraded", checks: { ai: "attention" } });
  });

  it("is degraded when a tenant has spent 90 % of its monthly AI limit", async () => {
    const { tenant } = await setup();
    await db.update(tenants).set({ aiMonthlyLimitCents: 1_000 }).where(eq(tenants.id, tenant.id));
    await db.insert(aiUsage).values({ tenantId: tenant.id, purpose: "x", model: "m", inputTokens: 1, outputTokens: 1, costMicroUsd: 9_000_000 });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "degraded", checks: { ai: "attention" } });
  });

  it("is degraded when the database doesn't track its migrations", async () => {
    vi.mocked(health.migrationsTracked).mockResolvedValue(false);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "degraded", checks: { db: "ok", ai: "ok", migrations: "untracked" } });
  });

  it("is down, with 503, when the database doesn't answer", async () => {
    const refused = new Error("connect ECONNREFUSED 10.0.0.5:5432");
    vi.mocked(health.pingDatabase).mockRejectedValue(refused);
    vi.mocked(health.aiNeedsAttention).mockRejectedValueOnce(refused);
    vi.mocked(health.migrationsTracked).mockRejectedValue(refused);

    const res = await GET();

    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ status: "down", checks: { db: "down", ai: "unknown", migrations: "unknown" } });
    // Why is in the log, not in the answer.
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    expect(console.warn).toHaveBeenCalledTimes(3);
    expect(JSON.parse(vi.mocked(console.warn).mock.calls[0]![0] as string)).toMatchObject({ level: "warn", event: "health.check_failed", check: expect.any(String) });
  });

  it("answers in time when a check hangs: the slow one counts as failed", async () => {
    vi.useFakeTimers();
    vi.mocked(health.pingDatabase).mockReturnValue(new Promise(() => {}));
    vi.mocked(health.aiNeedsAttention).mockResolvedValueOnce(false);

    const answer = GET();
    await vi.advanceTimersByTimeAsync(2_000);
    const res = await answer;

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "down", checks: { db: "down", ai: "ok", migrations: "ok" } });
    expect(JSON.parse(vi.mocked(console.warn).mock.calls[0]![0] as string)).toMatchObject({ event: "health.check_failed", check: "db", error: { message: "No answer in 2000 ms" } });
  });

  it("tells nothing about the tenants or their data: only the fields above, no numbers, no names, no ids", async () => {
    const { tenant, project } = await setup();
    await db.update(tenants).set({ aiMonthlyLimitCents: 1_234 }).where(eq(tenants.id, tenant.id));
    await db.insert(aiUsage).values({ tenantId: tenant.id, purpose: "x", model: "m", inputTokens: 1, outputTokens: 1, costMicroUsd: 12_340_000 });
    await db.insert(budgetGenerations).values({ tenantId: tenant.id, projectId: project.id, status: "failed", error: "unexpected", options: {}, documentIds: [] });

    const res = await GET();
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(["checks", "commit", "status", "time"]);
    expect(Object.keys(body.checks as object).sort()).toEqual(["ai", "db", "migrations"]);
    for (const value of [body.status, body.commit, ...Object.values(body.checks as object)]) expect(typeof value).toBe("string");
    // Apart from the time, not a digit: no count, no amount, no id.
    expect(JSON.stringify({ ...body, time: null })).not.toMatch(/\d/);
    for (const secret of [tenant.id, tenant.name, tenant.slug, project.id, project.ref, "Calle", "unexpected"]) expect(text).not.toContain(secret);
  });
});

// Public and uncached downstream: the checks must not run once per hit.
describe("GET /api/health, hit often", () => {
  const runs = () => ({
    db: vi.mocked(health.pingDatabase).mock.calls.length,
    ai: vi.mocked(health.aiNeedsAttention).mock.calls.length,
    migrations: vi.mocked(health.migrationsTracked).mock.calls.length,
  });
  const once = { db: 1, ai: 1, migrations: 1 };

  beforeEach(() => {
    vi.mocked(health.pingDatabase).mockClear();
    vi.mocked(health.aiNeedsAttention).mockClear();
    vi.mocked(health.migrationsTracked).mockClear();
  });

  it("runs the checks once for any number of requests at the same time", async () => {
    await setup();

    const answers = await Promise.all(Array.from({ length: 25 }, () => GET()));

    expect(runs()).toEqual(once);
    const bodies = await Promise.all(answers.map((res) => res.json()));
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(bodies[0]).toMatchObject({ status: "ok", checks: { db: "ok", ai: "ok", migrations: "ok" } });
    for (const res of answers) {
      expect(res.status).toBe(200);
      // Kept here, never downstream.
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("answers from the kept result for 10 seconds, saying when the checks ran, then runs them again", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-14T10:00:00.000Z") });
    vi.mocked(health.pingDatabase).mockResolvedValue();
    vi.mocked(health.aiNeedsAttention).mockResolvedValue(false);

    const first = await (await GET()).json();
    vi.setSystemTime(Date.now() + HEALTH_FRESH_MS - 1);
    const again = await (await GET()).json();

    expect(runs()).toEqual(once);
    expect(again).toEqual(first);
    expect(first.time).toBe("2026-11-14T10:00:00.000Z");

    vi.setSystemTime(Date.now() + 1);
    // What changed meanwhile shows on the next run.
    vi.mocked(health.aiNeedsAttention).mockResolvedValue(true);
    const later = await (await GET()).json();

    expect(runs()).toEqual({ db: 2, ai: 2, migrations: 2 });
    expect(later).toMatchObject({ status: "degraded", time: "2026-11-14T10:00:10.000Z" });
    expect(HEALTH_FRESH_MS).toBe(10_000);
  });

  it("keeps `down` for 2 seconds only, so the database coming back shows quickly", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-14T10:00:00.000Z") });
    vi.mocked(health.aiNeedsAttention).mockResolvedValue(false);
    vi.mocked(health.pingDatabase).mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    expect((await GET()).status).toBe(503);
    // Hit in a loop while down: still one run, and one line in the log.
    vi.mocked(health.pingDatabase).mockResolvedValue();
    for (let i = 0; i < 10; i++) expect((await GET()).status).toBe(503);
    vi.setSystemTime(Date.now() + HEALTH_DOWN_FRESH_MS - 1);
    expect((await GET()).status).toBe(503);
    expect(runs()).toEqual(once);
    expect(console.warn).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 1);
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", checks: { db: "ok" } });
    expect(runs().db).toBe(2);
    expect(HEALTH_DOWN_FRESH_MS).toBe(2_000);
  });

  it("starts one new run, not one per request, when the kept result has expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.mocked(health.pingDatabase).mockResolvedValue();
    vi.mocked(health.aiNeedsAttention).mockResolvedValue(false);
    await GET();
    vi.setSystemTime(Date.now() + HEALTH_FRESH_MS);

    await Promise.all(Array.from({ length: 10 }, () => GET()));

    expect(runs()).toEqual({ db: 2, ai: 2, migrations: 2 });
  });
});

