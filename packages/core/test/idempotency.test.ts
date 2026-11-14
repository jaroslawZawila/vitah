import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase, withoutTable } from "@repo/db/testing";
import {
  aiUsage,
  and,
  db,
  eq,
  idempotencyKeys,
  obraIssues,
  purchaseInvoices,
  purchaseOrderAmendments,
  purchaseOrderDocuments,
  purchaseOrders,
  purchasePayments,
  purchaseRequests,
} from "@repo/db";
import {
  budgetService,
  constructionService,
  CoreError,
  purchaseAmendmentsService,
  purchaseInvoicesService,
  purchaseRequestsService,
  purchasingService,
  subcontractorsService,
  type Ctx,
} from "../src";
import { idempotent, KEEP_KEYS_MS, requestHash, sweepOldKeys } from "../src/idempotency";
import { setSweepDraw } from "../src/sweep";
import * as storage from "../src/storage";
import { files } from "../src/testing";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));

const pdf = (content = "%PDF-1.7 justificante", name = "Justificante.pdf") => new File([content], name, { type: "application/pdf" });

const newKey = () => crypto.randomUUID();

async function tenantCtx(): Promise<Ctx> {
  const tenant = await createTestTenant();
  return { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" };
}

// What a guarded write does, here: one row of the tenant per run.
const effect = (run: Pick<typeof db, "insert">, ctx: Ctx, purpose: string) =>
  run.insert(aiUsage).values({ tenantId: ctx.tenantId, purpose, model: "test", inputTokens: 0, outputTokens: 0, costMicroUsd: 0 });

const effects = async (ctx: Ctx) => (await db.select().from(aiUsage).where(eq(aiUsage.tenantId, ctx.tenantId))).map((row) => row.purpose);

const keysOf = (ctx: Ctx) => db.select().from(idempotencyKeys).where(eq(idempotencyKeys.tenantId, ctx.tenantId));

/**
 * A create whose whole work is `fn`, in a transaction of its own under the
 * key: what every keyed create does, through the one way in (`idempotent`).
 */
const guarded = <T>(ctx: Ctx, key: unknown, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>, request: Record<string, unknown> | null = null, scope = "test.write") =>
  idempotent<T>(ctx, scope, {}, { ...request, idempotencyKey: key }, (once) => db.transaction((tx) => once(tx, () => fn(tx))));

/** One guarded write: → what the key's first call answered. */
const write = (ctx: Ctx, key: unknown, request: Record<string, unknown> | null = { amount: 1 }, scope = "test.write", purpose = "write") =>
  guarded(
    ctx,
    key,
    async (tx) => {
      await effect(tx, ctx, purpose);
      return { id: crypto.randomUUID(), purpose };
    },
    request,
    scope,
  );

/** Resolves when `release` is called: holds a transaction open. */
function gate() {
  let release = () => {};
  const opened = new Promise<void>((resolve) => (release = resolve));
  return { opened, release };
}

const settled = (promise: Promise<unknown>) => {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  return () => done;
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});
afterEach(() => setSweepDraw());

describe("a keyed write", () => {
  it("runs the first call and keeps its answer; the same key and request gets it back without running again", async () => {
    const ctx = await tenantCtx();
    const key = newKey();

    const first = await write(ctx, key);
    const second = await write(ctx, key);
    const third = await write(ctx, key, { amount: 1 });

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(await effects(ctx)).toEqual(["write"]);
    expect(await keysOf(ctx)).toMatchObject([{ scope: "test.write", key, userId: ctx.userId, result: first }]);
  });

  it("refuses the key with another request: 409, and nothing runs", async () => {
    const ctx = await tenantCtx();
    const key = newKey();
    const first = await write(ctx, key, { amount: 1 });

    await expect(write(ctx, key, { amount: 2 })).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 });
    expect(await effects(ctx)).toEqual(["write"]);
    // The first answer is still the key's.
    expect(await write(ctx, key, { amount: 1 })).toEqual(first);
  });

  it("runs every time without a key", async () => {
    const ctx = await tenantCtx();

    const first = await write(ctx, undefined);
    const second = await write(ctx, undefined);
    const third = await write(ctx, null);

    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
    expect(await effects(ctx)).toHaveLength(3);
    expect(await keysOf(ctx)).toEqual([]);
  });

  it("keeps no key when the write fails: the same key runs again", async () => {
    const ctx = await tenantCtx();
    const key = newKey();
    const failing = guarded(ctx, key, async (tx) => {
      await effect(tx, ctx, "failed");
      throw new CoreError("exceeds_amount", 409);
    });
    await expect(failing).rejects.toMatchObject({ code: "exceeds_amount" });
    expect(await keysOf(ctx)).toEqual([]);
    expect(await effects(ctx)).toEqual([]);

    const made = await write(ctx, key, null);
    expect(await effects(ctx)).toEqual(["write"]);
    expect(await write(ctx, key, null)).toEqual(made);
  });

  it("makes one record of two calls at once, and answers both the same", async () => {
    const ctx = await tenantCtx();
    for (let round = 0; round < 8; round++) {
      const key = newKey();
      const answers = await Promise.all([1, 2, 3].map(() => write(ctx, key, { round }, "test.write", `round-${round}`)));
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[2]).toEqual(answers[0]);
      expect((await effects(ctx)).filter((purpose) => purpose === `round-${round}`)).toHaveLength(1);
    }
    expect(await keysOf(ctx)).toHaveLength(8);
  });

  it("makes a call wait for the one in flight, then answers what that one committed", async () => {
    const ctx = await tenantCtx();
    const key = newKey();
    const hold = gate();
    const started = gate();
    const first = guarded(ctx, key, async (tx) => {
      await effect(tx, ctx, "first");
      started.release();
      await hold.opened;
      return { by: "first" };
    });
    await started.opened;
    const ran = vi.fn(async () => ({ by: "second" }));
    const second = guarded(ctx, key, ran);
    const secondDone = settled(second);
    await pause(150);
    // Nothing answered yet: it waits on the key the first transaction holds.
    expect(secondDone()).toBe(false);

    hold.release();
    expect(await first).toEqual({ by: "first" });
    expect(await second).toEqual({ by: "first" });
    expect(ran).not.toHaveBeenCalled();
    expect(await effects(ctx)).toEqual(["first"]);
  });

  it("lets a waiting call run when the one in flight rolls back", async () => {
    const ctx = await tenantCtx();
    const key = newKey();
    const hold = gate();
    const started = gate();
    const first = guarded(ctx, key, async (tx) => {
      await effect(tx, ctx, "first");
      started.release();
      await hold.opened;
      throw new CoreError("invalid_state", 409);
    });
    const firstEnded = first.then(
      (answer) => ({ answer }),
      (error: CoreError) => ({ failed: error.code }),
    );
    await started.opened;
    const second = write(ctx, key, null, "test.write", "second");
    const secondDone = settled(second);
    await pause(150);
    expect(secondDone()).toBe(false);

    hold.release();
    const ended = await firstEnded;
    const made = await second;
    expect(made).toMatchObject({ purpose: "second" });
    // The first failed, and says so; had the second been in by the time it looked, that one's answer.
    expect(ended).toEqual("failed" in ended ? { failed: "invalid_state" } : { answer: made });
    expect(await effects(ctx)).toEqual(["second"]);
    expect(await keysOf(ctx)).toHaveLength(1);
  });

  it("keeps tenants apart: the same key in two tenants is two keys", async () => {
    const [one, two] = [await tenantCtx(), await tenantCtx()];
    const key = newKey();

    const first = await write(one, key);
    const second = await write(two, key);

    expect(second.id).not.toBe(first.id);
    expect(await effects(one)).toHaveLength(1);
    expect(await effects(two)).toHaveLength(1);
    // Another tenant's request under the key never answers, nor clashes with, this one's.
    expect(await write(two, key, { amount: 99 }).catch((error: CoreError) => error.code)).toBe("idempotency_key_reused");
    expect(await write(one, key)).toEqual(first);
  });

  it("keeps operations apart: the same key in two scopes is two keys", async () => {
    const ctx = await tenantCtx();
    const key = newKey();

    const payment = await write(ctx, key, { amount: 1 }, "test.payment", "payment");
    const order = await write(ctx, key, { other: true }, "test.order", "order");

    expect(order.id).not.toBe(payment.id);
    expect((await effects(ctx)).sort()).toEqual(["order", "payment"]);
    expect(await write(ctx, key, { amount: 1 }, "test.payment")).toEqual(payment);
  });

  it("takes a UUID or 16–100 URL-safe characters, and nothing else", async () => {
    const ctx = await tenantCtx();
    for (const key of ["a".repeat(16), "Zx_9-".repeat(20), newKey()]) {
      await expect(write(ctx, key)).resolves.toMatchObject({ purpose: "write" });
    }
    for (const key of ["", "short", "a".repeat(15), "a".repeat(101), "with space 0123456789", "ñandú-0123456789012", "a/b+c=0123456789abcd", 42, {}, true]) {
      await expect(write(ctx, key)).rejects.toMatchObject({ code: "invalid_input", status: 400 });
    }
    expect(await effects(ctx)).toHaveLength(3);
  });
});

describe("requestHash", () => {
  it("is the same whatever the order of the fields, and tells values apart", async () => {
    const hash = await requestHash({ a: 1, b: { c: [1, 2], d: null }, e: undefined });
    expect(await requestHash({ b: { d: null, c: [1, 2] }, a: 1 })).toBe(hash);
    expect(await requestHash({ a: 1, b: { c: [2, 1], d: null } })).not.toBe(hash);
    expect(await requestHash({ a: "1", b: { c: [1, 2], d: null } })).not.toBe(hash);
  });

  it("tells files apart by what they hold, not by their name", async () => {
    const hash = await requestHash({ file: pdf("%PDF-1.7 uno") });
    expect(await requestHash({ file: pdf("%PDF-1.7 uno", "otro-nombre.pdf") })).toBe(hash);
    expect(await requestHash({ file: pdf("%PDF-1.7 dos") })).not.toBe(hash);
  });
});

describe("idempotent", () => {
  const scope = "test.create";

  /** A create as the services write them: checks first, then one transaction around `once`. */
  const create = (ctx: Ctx, input: Record<string, unknown>, checked = vi.fn()) =>
    idempotent<{ id: string }>(ctx, scope, { projectId: "p1" }, input, async (guard) => {
      checked();
      if (input.amount === 0) throw new CoreError("invalid_input", 400);
      return db.transaction((tx) =>
        guard(tx, async () => {
          await effect(tx, ctx, "create");
          return { id: crypto.randomUUID() };
        }),
      );
    });

  it("answers a key already in at once: nothing is checked or written again", async () => {
    const ctx = await tenantCtx();
    const idempotencyKey = newKey();
    const checked = vi.fn();

    const first = await create(ctx, { amount: 5, idempotencyKey }, checked);
    const again = await create(ctx, { idempotencyKey, amount: 5 }, checked);

    expect(again).toEqual(first);
    expect(checked).toHaveBeenCalledTimes(1);
    expect(await effects(ctx)).toEqual(["create"]);
  });

  it("refuses the key with another body or on another target, and lets a failed create run again", async () => {
    const ctx = await tenantCtx();
    const idempotencyKey = newKey();

    await expect(create(ctx, { amount: 0, idempotencyKey })).rejects.toMatchObject({ code: "invalid_input" });
    // It failed: the key is free, even for other values.
    const made = await create(ctx, { amount: 5, idempotencyKey });
    await expect(create(ctx, { amount: 6, idempotencyKey })).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 });
    await expect(
      idempotent(ctx, scope, { projectId: "p2" }, { amount: 5, idempotencyKey }, async () => ({ id: "never" })),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    expect(await create(ctx, { amount: 5, idempotencyKey })).toEqual(made);
    expect(await effects(ctx)).toEqual(["create"]);
  });

  it("runs as ever without a key, and refuses one that isn't a key before anything runs", async () => {
    const ctx = await tenantCtx();
    const checked = vi.fn();

    const first = await create(ctx, { amount: 5 }, checked);
    const second = await create(ctx, { amount: 5, idempotencyKey: null }, checked);
    await expect(create(ctx, { amount: 5, idempotencyKey: "nope" }, checked)).rejects.toMatchObject({ code: "invalid_input", status: 400 });

    expect(second.id).not.toBe(first.id);
    expect(checked).toHaveBeenCalledTimes(2);
    expect(await keysOf(ctx)).toEqual([]);
  });

  it("answers with the other call's record when that one got in while this one was failing its checks", async () => {
    const ctx = await tenantCtx();
    const idempotencyKey = newKey();
    const input = { amount: 5, idempotencyKey };
    let other: { id: string } | undefined;

    // This call finds no key, then the same request commits, then its own checks fail on what that changed.
    const answer = await idempotent<{ id: string }>(ctx, scope, { projectId: "p1" }, input, async () => {
      other = await create(ctx, input);
      throw new CoreError("invalid_state", 409);
    });

    expect(answer).toEqual(other);
    expect(await effects(ctx)).toEqual(["create"]);
  });
});

describe("sweepOldKeys", () => {
  it("now and then deletes the keys older than a week, and only those", async () => {
    const ctx = await tenantCtx();
    const [old, recent] = [newKey(), newKey()];
    await write(ctx, old);
    await write(ctx, recent, { amount: 2 });
    const aged = new Date(Date.now() - KEEP_KEYS_MS - 60_000);
    await db.update(idempotencyKeys).set({ createdAt: aged }).where(and(eq(idempotencyKeys.tenantId, ctx.tenantId), eq(idempotencyKeys.key, old)));

    // Not this time.
    setSweepDraw(() => 0.5);
    await sweepOldKeys();
    expect(await keysOf(ctx)).toHaveLength(2);

    setSweepDraw(() => 0);
    await sweepOldKeys();
    expect((await keysOf(ctx)).map((row) => row.key)).toEqual([recent]);
    // Swept: the old key is a new one.
    expect(await write(ctx, old, { amount: 3 })).toMatchObject({ purpose: "write" });
  });

  it("sweeps after a keyed create when its turn comes", async () => {
    const ctx = await tenantCtx();
    await write(ctx, newKey());
    await db.update(idempotencyKeys).set({ createdAt: new Date(Date.now() - KEEP_KEYS_MS - 60_000) });
    const made = (random: () => number) => {
      setSweepDraw(random);
      return idempotent<{ ok: boolean }>(ctx, "test.create", {}, { idempotencyKey: newKey() }, (guard) => db.transaction((tx) => guard(tx, async () => ({ ok: true }))));
    };

    await made(() => 0.99);
    expect(await keysOf(ctx)).toHaveLength(2);
    await made(() => 0);
    // The old one went; the two just made stay.
    expect(await keysOf(ctx)).toHaveLength(2);
  });
});

// ─── The creates that take a key ─────────────────────────────────────────────

const company = (overrides: Record<string, unknown> = {}) => ({
  kind: "company",
  legalName: "Montajes Steel Norte S.L.",
  taxId: "B39123450",
  address: "Polígono Raos 4",
  postalCode: "39600",
  city: "Maliaño",
  ...overrides,
});

/**
 * A project with an accepted budget of chapters 01–03 (one line of 1.000 € at
 * cost each), a subcontractor and a material supplier.
 */
async function setup() {
  const tenant = await createTestTenant();
  const admin: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" };
  const ctx: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "manager", name: "Laura Pérez" })).id, role: "manager" };
  const project = await createTestProject(tenant.id, {
    startDate: new Date("2026-06-01T00:00:00Z"),
    completionDate: new Date("2027-03-31T00:00:00Z"),
  });
  const { revisionId } = await framerDraft(admin, project.id, ["01", "02", "03"]);
  await budgetService.acceptRevision(admin, project.id, revisionId, {}, { unissued: true });
  const { id: subcontractorId } = await subcontractorsService.createSubcontractor(admin, company());
  const { id: supplierId } = await subcontractorsService.createSubcontractor(
    admin,
    company({ legalName: "Piedra de Liébana S.L.", taxId: "B39654322", suppliesOnly: true }),
  );
  const form = await purchasingService.getPurchaseForm(admin, project.id);
  const lineage = (code: string) => form.chapters.find((c) => c.code === code)!.lines[0]!.lineageId;
  return { tenant, admin, ctx, project, subcontractorId, supplierId, lineage };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const order = (s: Setup, overrides: Record<string, unknown> = {}) => ({
  kind: "subcontract",
  subcontractorId: s.subcontractorId,
  description: "Estructura Steel Frame",
  status: "contracted",
  orderedOn: "2026-06-18",
  lines: [
    { lineageId: s.lineage("01"), amountCents: 80_000 },
    { lineageId: s.lineage("02"), amountCents: 40_000 },
  ],
  ...overrides,
});

const invoice = (overrides: Record<string, unknown> = {}) => ({ number: "MSN-2026/112", issuedOn: "2026-09-22", baseCents: 60_000, ...overrides });

describe("the creates, sent twice with the same key", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
  });
  afterEach(() => vi.useRealTimers());

  it("createPurchase: one order, the same id and number, and the next order takes the next number", async () => {
    const s = await setup();
    const idempotencyKey = newKey();

    const first = await purchasingService.createPurchase(s.ctx, s.project.id, { ...order(s), idempotencyKey });
    const again = await purchasingService.createPurchase(s.ctx, s.project.id, { ...order(s), idempotencyKey });
    const [one, two] = await Promise.all([1, 2].map(() => purchasingService.createPurchase(s.ctx, s.project.id, { ...order(s), idempotencyKey })));
    const next = await purchasingService.createPurchase(s.ctx, s.project.id, { ...order(s), idempotencyKey: newKey() });

    expect(first).toMatchObject({ number: 1 });
    expect([again, one, two]).toEqual([first, first, first]);
    expect(next.number).toBe(2);
    const rows = await db.select({ number: purchaseOrders.number }).from(purchaseOrders).where(eq(purchaseOrders.projectId, s.project.id));
    expect(rows.map((row) => row.number).sort()).toEqual([1, 2]);
    await expect(
      purchasingService.createPurchase(s.ctx, s.project.id, { ...order(s, { description: "Otra cosa" }), idempotencyKey }),
    ).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 });
  });

  it("createPurchase: two orders at once with one key are one order, round after round, with no gap in the numbers", async () => {
    const s = await setup();
    for (let round = 1; round <= 5; round++) {
      const idempotencyKey = newKey();
      const made = await Promise.all([1, 2, 3].map(() => purchasingService.createPurchase(s.ctx, s.project.id, { ...order(s), idempotencyKey })));
      expect(made).toEqual([made[0], made[0], made[0]]);
      expect(made[0]!.number).toBe(round);
    }
    // Without a key each is its own order, numbered in turn as before.
    const loose = await Promise.all([1, 2, 3].map(() => purchasingService.createPurchase(s.ctx, s.project.id, order(s))));
    expect(loose.map((o) => o.number).sort()).toEqual([6, 7, 8]);
  });

  it("createPurchase from a request: the retry answers the order made, though the request is no longer approved", async () => {
    const s = await setup();
    const { requestId } = await purchaseRequestsService.createRequest(s.ctx, s.project.id, {
      kind: "subcontract",
      description: "Estructura",
      lines: [{ lineageId: s.lineage("01"), amountCents: 80_000 }],
    });
    await purchaseRequestsService.decideRequest(s.admin, requestId, { decision: "approve" });
    const input = { ...order(s), requestId, idempotencyKey: newKey() };

    const first = await purchasingService.createPurchase(s.ctx, s.project.id, input);
    const again = await purchasingService.createPurchase(s.ctx, s.project.id, input);

    expect(again).toEqual(first);
    expect(await db.select().from(purchaseOrders).where(eq(purchaseOrders.projectId, s.project.id))).toHaveLength(1);
    // Another key is another order, and the request has its own already.
    await expect(purchasingService.createPurchase(s.ctx, s.project.id, { ...input, idempotencyKey: newKey() })).rejects.toMatchObject({
      code: "request_not_approved",
    });
  });

  it("createRequest: one request, the same id and number, and no gap after it", async () => {
    const s = await setup();
    const input = {
      kind: "material",
      description: "Piedra para la fachada",
      subcontractorId: s.supplierId,
      lines: [{ lineageId: s.lineage("01"), amountCents: 60_000 }],
      idempotencyKey: newKey(),
    };

    const first = await purchaseRequestsService.createRequest(s.ctx, s.project.id, input);
    const [one, two] = await Promise.all([1, 2].map(() => purchaseRequestsService.createRequest(s.ctx, s.project.id, input)));
    const next = await purchaseRequestsService.createRequest(s.ctx, s.project.id, { ...input, idempotencyKey: newKey() });

    expect(first).toMatchObject({ number: 1 });
    expect([one, two]).toEqual([first, first]);
    expect(next.number).toBe(2);
    expect(await db.select().from(purchaseRequests).where(eq(purchaseRequests.projectId, s.project.id))).toHaveLength(2);
  });

  it("createIssue: one record per key, numbered per kind without a gap", async () => {
    const s = await setup();
    const issue = { kind: "issue", occurredOn: "2026-10-08", chapterCode: "02", description: "Retraso del panel", party: "subcontractor" };
    const idempotencyKey = newKey();

    const made = await Promise.all([1, 2, 3].map(() => constructionService.createIssue(s.ctx, s.project.id, { ...issue, idempotencyKey })));
    const again = await constructionService.createIssue(s.ctx, s.project.id, { ...issue, idempotencyKey });
    const next = await constructionService.createIssue(s.ctx, s.project.id, { ...issue, idempotencyKey: newKey() });
    const change = await constructionService.createIssue(s.ctx, s.project.id, { ...issue, kind: "change", idempotencyKey: newKey() });

    expect(made[0]).toMatchObject({ number: 1 });
    expect([made[1], made[2], again]).toEqual([made[0], made[0], made[0]]);
    expect(next.number).toBe(2);
    expect(change.number).toBe(1);
    expect(await db.select().from(obraIssues).where(eq(obraIssues.projectId, s.project.id))).toHaveLength(3);
    // Without a key, as before: each its own record.
    const loose = await Promise.all([1, 2].map(() => constructionService.createIssue(s.ctx, s.project.id, issue)));
    expect(loose.map((i) => i.number).sort()).toEqual([3, 4]);
  });

  it("createInvoice: one invoice and one stored PDF; the retry isn't a duplicate number", async () => {
    const s = await setup();
    const { orderId } = await purchasingService.createPurchase(s.ctx, s.project.id, order(s));
    const idempotencyKey = newKey();
    const input = () => ({ ...invoice(), file: pdf("%PDF-1.7 factura"), idempotencyKey });

    const first = await purchaseInvoicesService.createInvoice(s.ctx, orderId, input());
    const again = await purchaseInvoicesService.createInvoice(s.ctx, orderId, input());
    const [one, two] = await Promise.all([1, 2].map(() => purchaseInvoicesService.createInvoice(s.ctx, orderId, input())));

    expect([again, one, two]).toEqual([first, first, first]);
    expect(await db.select().from(purchaseInvoices).where(eq(purchaseInvoices.orderId, orderId))).toHaveLength(1);
    expect(files.size).toBe(1);
    // The same number under another key is the duplicate it always was; another PDF under the key, another request.
    await expect(purchaseInvoicesService.createInvoice(s.ctx, orderId, { ...invoice(), idempotencyKey: newKey() })).rejects.toMatchObject({
      code: "duplicate_number",
    });
    await expect(
      purchaseInvoicesService.createInvoice(s.ctx, orderId, { ...invoice(), file: pdf("%PDF-1.7 otra"), idempotencyKey }),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    expect(files.size).toBe(1);
  });

  it("createInvoice: two at once with one key store one PDF, the other's copy removed", async () => {
    const s = await setup();
    const { orderId } = await purchasingService.createPurchase(s.ctx, s.project.id, order(s));
    for (let round = 1; round <= 4; round++) {
      const idempotencyKey = newKey();
      const made = await Promise.all(
        [1, 2, 3].map(() =>
          purchaseInvoicesService.createInvoice(s.ctx, orderId, { ...invoice({ number: `F-${round}`, baseCents: 1_000 }), file: pdf(`%PDF-1.7 ${round}`), idempotencyKey }),
        ),
      );
      expect(made).toEqual([made[0], made[0], made[0]]);
      expect(files.size).toBe(round);
    }
    expect(await db.select().from(purchaseInvoices).where(eq(purchaseInvoices.orderId, orderId))).toHaveLength(4);
  });

  it("createPayment: the same payment sent again is paid once", async () => {
    const s = await setup();
    const { orderId } = await purchasingService.createPurchase(s.ctx, s.project.id, order(s));
    const { invoiceId } = await purchaseInvoicesService.createInvoice(s.ctx, orderId, invoice());
    const idempotencyKey = newKey();
    const input = () => ({ amountCents: 20_000, paidOn: "2026-10-01", reference: "TRF-1", file: pdf(), idempotencyKey });

    const first = await purchaseInvoicesService.createPayment(s.ctx, invoiceId, input());
    const again = await purchaseInvoicesService.createPayment(s.ctx, invoiceId, input());

    expect(again).toEqual(first);
    expect(await db.select().from(purchasePayments).where(eq(purchasePayments.invoiceId, invoiceId))).toHaveLength(1);
    expect(files.size).toBe(1);
    expect(await purchaseInvoicesService.getInvoice(s.ctx, invoiceId)).toMatchObject({ paidCents: 20_000, payments: [{ id: first.paymentId }] });
    // A second payment of the same amount is a new key, as a new form sends.
    const second = await purchaseInvoicesService.createPayment(s.ctx, invoiceId, { ...input(), idempotencyKey: newKey() });
    expect(second.paymentId).not.toBe(first.paymentId);
    expect(await purchaseInvoicesService.getInvoice(s.ctx, invoiceId)).toMatchObject({ paidCents: 40_000 });
    // The key with another amount, or on another invoice, is refused.
    await expect(purchaseInvoicesService.createPayment(s.ctx, invoiceId, { ...input(), amountCents: 1 })).rejects.toMatchObject({
      code: "idempotency_key_reused",
      status: 409,
    });
    const other = await purchaseInvoicesService.createInvoice(s.ctx, orderId, invoice({ number: "MSN-2026/113", baseCents: 30_000 }));
    await expect(purchaseInvoicesService.createPayment(s.ctx, other.invoiceId, input())).rejects.toMatchObject({ code: "idempotency_key_reused" });
    expect(await db.select().from(purchasePayments)).toHaveLength(2);
  });

  it("createPayment: sent at once with one key, round after round, each is one payment and one proof", async () => {
    const s = await setup();
    const { orderId } = await purchasingService.createPurchase(s.ctx, s.project.id, order(s));
    const { invoiceId } = await purchaseInvoicesService.createInvoice(s.ctx, orderId, invoice());
    for (let round = 1; round <= 6; round++) {
      const idempotencyKey = newKey();
      const made = await Promise.all(
        [1, 2, 3, 4].map(() => purchaseInvoicesService.createPayment(s.ctx, invoiceId, { amountCents: 1_000, paidOn: "2026-10-01", file: pdf(`%PDF-1.7 ${round}`), idempotencyKey })),
      );
      expect(new Set(made.map((m) => m.paymentId)).size).toBe(1);
      expect(await db.select().from(purchasePayments).where(eq(purchasePayments.invoiceId, invoiceId))).toHaveLength(round);
      expect(files.size).toBe(round);
    }
    expect(await purchaseInvoicesService.getInvoice(s.ctx, invoiceId)).toMatchObject({ paidCents: 6_000 });
  });

  it("createPayment: a payment refused keeps no key, so the same key pays once it fits", async () => {
    const s = await setup();
    const { orderId } = await purchasingService.createPurchase(s.ctx, s.project.id, order(s));
    const { invoiceId } = await purchaseInvoicesService.createInvoice(s.ctx, orderId, invoice());
    const idempotencyKey = newKey();

    await expect(
      purchaseInvoicesService.createPayment(s.ctx, invoiceId, { amountCents: 99_999_999, paidOn: "2026-10-01", file: pdf(), idempotencyKey }),
    ).rejects.toMatchObject({ code: "exceeds_amount" });
    expect(await keysOf(s.ctx)).toEqual([]);
    expect(files.size).toBe(0);
    const paid = await purchaseInvoicesService.createPayment(s.ctx, invoiceId, { amountCents: 10_000, paidOn: "2026-10-01", idempotencyKey });
    expect(await db.select().from(purchasePayments).where(eq(purchasePayments.invoiceId, invoiceId))).toMatchObject([{ id: paid.paymentId, amountCents: 10_000 }]);
  });

  it("createPayment: keeps tenants apart, and a viewer's retry is still forbidden", async () => {
    const s = await setup();
    const { orderId } = await purchasingService.createPurchase(s.ctx, s.project.id, order(s));
    const { invoiceId } = await purchaseInvoicesService.createInvoice(s.ctx, orderId, invoice());
    const input = { amountCents: 20_000, paidOn: "2026-10-01", idempotencyKey: newKey() };
    await purchaseInvoicesService.createPayment(s.ctx, invoiceId, input);

    const stranger = await tenantCtx();
    await expect(purchaseInvoicesService.createPayment(stranger, invoiceId, input)).rejects.toMatchObject({ code: "not_found" });
    const viewer: Ctx = { tenantId: s.tenant.id, userId: (await createTestUser(s.tenant.id, { role: "viewer" })).id, role: "viewer" };
    await expect(purchaseInvoicesService.createPayment(viewer, invoiceId, input)).rejects.toMatchObject({ code: "forbidden" });
    expect(await db.select().from(purchasePayments)).toHaveLength(1);
  });

  const amendment = (s: Setup, overrides: Record<string, unknown> = {}) => ({
    concept: "Refuerzo de forjado",
    signedOn: "2026-10-12",
    lines: [
      { lineageId: s.lineage("01"), amountCents: 87_000 },
      { lineageId: s.lineage("02"), amountCents: 40_000 },
    ],
    ...overrides,
  });

  const amendmentsOf = (orderId: string) => db.select().from(purchaseOrderAmendments).where(eq(purchaseOrderAmendments.orderId, orderId));
  const documentsOf = (orderId: string) => db.select().from(purchaseOrderDocuments).where(eq(purchaseOrderDocuments.orderId, orderId));

  it("amendPurchase: one modificado with one number and one PDF, though the retry would change nothing by then", async () => {
    const s = await setup();
    const { orderId } = await purchasingService.createPurchase(s.ctx, s.project.id, order(s));
    const idempotencyKey = newKey();
    const input = () => ({ ...amendment(s), file: pdf("%PDF-1.7 modificado", "Modificado.pdf"), documentTitle: "Modificado nº {n}", idempotencyKey });

    const first = await purchaseAmendmentsService.amendPurchase(s.ctx, orderId, input());
    // Without the key this is `no_changes`: the lines are already as it says.
    const again = await purchaseAmendmentsService.amendPurchase(s.ctx, orderId, input());

    expect(first).toMatchObject({ number: 1, deltaCents: 7_000 });
    expect(again).toEqual(first);
    const [row] = await amendmentsOf(orderId);
    const documents = await documentsOf(orderId);
    expect(await amendmentsOf(orderId)).toHaveLength(1);
    expect(documents).toMatchObject([{ id: row!.documentId, title: "Modificado nº 1" }]);
    expect(files.size).toBe(1);
    // The next one is number 2.
    const next = await purchaseAmendmentsService.amendPurchase(s.ctx, orderId, {
      ...amendment(s, { lines: [{ lineageId: s.lineage("01"), amountCents: 90_000 }, { lineageId: s.lineage("02"), amountCents: 40_000 }] }),
      idempotencyKey: newKey(),
    });
    expect(next.number).toBe(2);
  });

  it("amendPurchase: sent at once with one key, one modificado and one document", async () => {
    const s = await setup();
    const { orderId } = await purchasingService.createPurchase(s.ctx, s.project.id, order(s));
    const idempotencyKey = newKey();

    const made = await Promise.all(
      [1, 2, 3].map(() => purchaseAmendmentsService.amendPurchase(s.ctx, orderId, { ...amendment(s), file: pdf("%PDF-1.7 modificado"), idempotencyKey })),
    );

    expect(made).toEqual([made[0], made[0], made[0]]);
    expect(made[0]).toMatchObject({ number: 1 });
    expect(await amendmentsOf(orderId)).toHaveLength(1);
    expect(await documentsOf(orderId)).toHaveLength(1);
    expect(files.size).toBe(1);
  });

  it("amendPurchase: a retry attaches the PDF the first call could not", async () => {
    const s = await setup();
    const { orderId } = await purchasingService.createPurchase(s.ctx, s.project.id, order(s));
    const idempotencyKey = newKey();
    const input = () => ({ ...amendment(s), file: pdf("%PDF-1.7 modificado"), idempotencyKey });
    const put = vi.spyOn(storage, "putFile").mockRejectedValueOnce(new Error("blob store down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const first = await purchaseAmendmentsService.amendPurchase(s.ctx, orderId, input());
    expect(first).toMatchObject({ number: 1, documentFailed: true });
    expect(await documentsOf(orderId)).toHaveLength(0);

    const again = await purchaseAmendmentsService.amendPurchase(s.ctx, orderId, input());
    expect(again).toEqual({ amendmentId: first.amendmentId, number: 1, deltaCents: 7_000 });
    const [row] = await amendmentsOf(orderId);
    expect(await amendmentsOf(orderId)).toHaveLength(1);
    expect(await documentsOf(orderId)).toMatchObject([{ id: row!.documentId }]);
    // And once more: nothing new.
    await purchaseAmendmentsService.amendPurchase(s.ctx, orderId, input());
    expect(await documentsOf(orderId)).toHaveLength(1);
    expect(files.size).toBe(1);
    put.mockRestore();
    logged.mockRestore();
  });
});

// ─── Before its table ────────────────────────────────────────────────────────

describe("without the idempotency_keys table (the portal deployed ahead of its SQL)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const warnings = (warn: { mock: { calls: unknown[][] } }) =>
    warn.mock.calls.map((call) => JSON.parse(call[0] as string) as { level: string; event: string; scope?: string; error?: { code?: string } });

  it("runs a keyed write as an unkeyed one, with one warning each, and keeps keys again once the table is there", async () => {
    const ctx = await tenantCtx();
    const key = newKey();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const [first, second] = await withoutTable("idempotency_keys", async () => [await write(ctx, key), await write(ctx, key)]);

    // Nothing remembered: each ran, as without a key.
    expect(second.id).not.toBe(first.id);
    expect(await effects(ctx)).toEqual(["write", "write"]);
    expect(warnings(warn)).toEqual([
      { level: "warn", time: expect.any(String), event: "idempotency.table_missing", scope: "test.write", error: expect.objectContaining({ code: "42P01" }) },
      { level: "warn", time: expect.any(String), event: "idempotency.table_missing", scope: "test.write", error: expect.objectContaining({ code: "42P01" }) },
    ]);

    // The table there: the key is a key again (and was never taken meanwhile).
    expect(await keysOf(ctx)).toEqual([]);
    const third = await write(ctx, key);
    expect(await write(ctx, key)).toEqual(third);
    await expect(write(ctx, key, { amount: 2 })).rejects.toMatchObject({ code: "idempotency_key_reused", status: 409 });
    expect(await effects(ctx)).toHaveLength(3);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("still refuses what isn't a key, and runs unkeyed creates without a warning", async () => {
    const ctx = await tenantCtx();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await withoutTable("idempotency_keys", async () => {
      await expect(write(ctx, "nope")).rejects.toMatchObject({ code: "invalid_input", status: 400 });
      await expect(write(ctx, undefined)).resolves.toMatchObject({ purpose: "write" });
    });

    expect(await effects(ctx)).toEqual(["write"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves a create's own failure what it is: nothing is written, and no other table's absence is taken for this one", async () => {
    const ctx = await tenantCtx();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await withoutTable("idempotency_keys", async () => {
      const failing = guarded(ctx, newKey(), async (tx) => {
        await effect(tx, ctx, "failed");
        throw new CoreError("exceeds_amount", 409);
      });
      await expect(failing).rejects.toMatchObject({ code: "exceeds_amount" });
    });
    expect(await effects(ctx)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);

    // The keys' table is there, the create's own is not: that is the create's error, unchanged.
    const broken = withoutTable("ai_usage", () => write(ctx, newKey()));
    await expect(broken).rejects.toSatisfy((error) => !(error instanceof CoreError) && /ai_usage/.test(String((error as Error).cause ?? error)));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await keysOf(ctx)).toEqual([]);
  });

  it("makes every one of the six creates as before keys: an order, a request, an incident, an invoice, a payment and a modificado", async () => {
    const s = await setup();
    const idempotencyKey = newKey();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const made = await withoutTable("idempotency_keys", async () => {
      const first = await purchasingService.createPurchase(s.ctx, s.project.id, { ...order(s), idempotencyKey });
      // The same key again is another order: nothing can remember the first.
      const again = await purchasingService.createPurchase(s.ctx, s.project.id, { ...order(s), idempotencyKey });
      const request = await purchaseRequestsService.createRequest(s.ctx, s.project.id, {
        kind: "material",
        description: "Piedra para la fachada",
        subcontractorId: s.supplierId,
        lines: [{ lineageId: s.lineage("01"), amountCents: 60_000 }],
        idempotencyKey,
      });
      const issue = await constructionService.createIssue(s.ctx, s.project.id, {
        kind: "issue",
        occurredOn: "2026-10-08",
        chapterCode: "02",
        description: "Retraso del panel",
        party: "subcontractor",
        idempotencyKey,
      });
      const { invoiceId } = await purchaseInvoicesService.createInvoice(s.ctx, first.orderId, { ...invoice(), file: pdf("%PDF-1.7 factura"), idempotencyKey });
      const payment = await purchaseInvoicesService.createPayment(s.ctx, invoiceId, { amountCents: 20_000, paidOn: "2026-10-01", file: pdf(), idempotencyKey });
      const amendment = await purchaseAmendmentsService.amendPurchase(s.ctx, first.orderId, {
        concept: "Refuerzo de forjado",
        signedOn: "2026-10-12",
        lines: [
          { lineageId: s.lineage("01"), amountCents: 87_000 },
          { lineageId: s.lineage("02"), amountCents: 40_000 },
        ],
        idempotencyKey,
      });
      return { first, again, request, issue, invoiceId, payment, amendment };
    });

    expect([made.first.number, made.again.number]).toEqual([1, 2]);
    expect(made.request).toMatchObject({ number: 1 });
    expect(made.issue).toMatchObject({ number: 1 });
    expect(made.amendment).toMatchObject({ number: 1, deltaCents: 7_000 });
    expect(await purchaseInvoicesService.getInvoice(s.ctx, made.invoiceId)).toMatchObject({ paidCents: 20_000, payments: [{ id: made.payment.paymentId }] });
    expect(files.size).toBe(2);
    expect(warnings(warn).map((line) => [line.event, line.scope])).toEqual([
      ["idempotency.table_missing", "purchase.order.create"],
      ["idempotency.table_missing", "purchase.order.create"],
      ["idempotency.table_missing", "purchase.request.create"],
      ["idempotency.table_missing", "obra.issue.create"],
      ["idempotency.table_missing", "purchase.invoice.create"],
      ["idempotency.table_missing", "purchase.payment.create"],
      ["idempotency.table_missing", "purchase.amendment.create"],
    ]);

    // With the table, the same key is one order again.
    const kept = await purchasingService.createPurchase(s.ctx, s.project.id, { ...order(s), idempotencyKey });
    expect(await purchasingService.createPurchase(s.ctx, s.project.id, { ...order(s), idempotencyKey })).toEqual(kept);
    expect(kept.number).toBe(3);
  });
});
