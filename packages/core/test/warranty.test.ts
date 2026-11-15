import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { db, eq, obraHitos, projects, warrantyClaimEvents, warrantyClaims } from "@repo/db";
import {
  addYears,
  clientAccountService,
  MAX_PHOTO_BYTES,
  projectsService,
  warrantyService as svc,
  type Ctx,
} from "../src";
import { todayInSpain } from "../src/obra-calc";
import { files, testImage } from "../src/testing";

vi.mock("../src/storage", async () => {
  const memory = await import("../src/testing");
  return { ...memory, putFile: vi.fn(memory.putFile) };
});
vi.mock("../src/photo-image", async (original) => {
  const actual = await original<typeof import("../src/photo-image")>();
  return { ...actual, readImage: vi.fn(actual.readImage) };
});
vi.mock("../src/push", () => ({ sendPush: vi.fn(async () => []) }));
const { sendPush } = await import("../src/push");
const { putFile } = await import("../src/storage");
const { readImage } = await import("../src/photo-image");

let photo: File;

beforeAll(async () => {
  photo = await testImage("jpeg", 400, 300);
});

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.mocked(sendPush).mockReset().mockResolvedValue([]);
  vi.mocked(putFile).mockClear();
  vi.mocked(readImage).mockClear();
});

const CLAIM = { kind: "plumbing", room: "bathroom", description: "El grifo del lavabo gotea.", urgent: true };

/** A handed-over home (stage 8) with its client and an admin. */
async function setup({ stage = 8 }: { stage?: number } = {}) {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, {
    clientUserId: client.id,
    obraStage: stage,
    startDate: new Date("2025-01-10"),
    completionDate: new Date("2026-03-31"),
  });
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  const create = (input: Record<string, unknown> = CLAIM) => svc.createClientClaim(tenant.id, client.id, project.id, input);
  return { tenant, admin, client, project, ctx, create };
}

const code = (promise: Promise<unknown>) => promise.then(() => "ok", (error: { code?: string }) => error.code);

describe("the client's claims", () => {
  it("sends claims numbered per home, newest first, with their history", async () => {
    const { tenant, client, project, create } = await setup();

    expect(await create()).toEqual({ claimId: expect.any(String), number: 1 });
    const { claimId } = await create({ kind: "damp", room: "bedroom", description: "Mancha en el techo" });

    const warranty = await svc.getClientWarranty(tenant.id, client.id, project.id);
    expect(warranty!.claims.map((c) => [c.number, c.kind, c.room, c.urgent, c.status])).toEqual([
      [2, "damp", "bedroom", false, "received"],
      [1, "plumbing", "bathroom", true, "received"],
    ]);
    const claim = await svc.getClientClaim(tenant.id, client.id, claimId);
    expect(claim.events).toEqual([{ id: expect.any(String), action: "created", at: expect.any(String), byClient: true, detail: {} }]);
    expect(claim.photoIds).toEqual([]);
  });

  it("asks for a home that is theirs and handed over", async () => {
    const { tenant, client, create } = await setup({ stage: 7 });
    expect(await code(create())).toBe("not_handed_over");

    const other = await setup();
    expect(await code(svc.createClientClaim(tenant.id, client.id, other.project.id, CLAIM))).toBe("project_not_found");
    // Another tenant's client, naming this home.
    expect(await code(svc.createClientClaim(other.tenant.id, other.client.id, (await setup()).project.id, CLAIM))).toBe(
      "project_not_found",
    );
  });

  it("checks what the client typed", async () => {
    const { create } = await setup();

    expect(await code(create({ ...CLAIM, kind: undefined }))).toBe("missing_fields");
    expect(await code(create({ ...CLAIM, kind: "roof" }))).toBe("invalid_input");
    expect(await code(create({ ...CLAIM, room: "attic" }))).toBe("invalid_input");
    expect(await code(create({ ...CLAIM, description: "   " }))).toBe("missing_fields");
    expect(await code(create({ ...CLAIM, description: "x".repeat(2001) }))).toBe("invalid_input");
    expect(await code(create({ ...CLAIM, urgent: "yes" }))).toBe("invalid_input");
    expect(await db.$count(warrantyClaims)).toBe(0);
  });

  it("takes a few claims a day per home, and a few waiting at once", async () => {
    const { project, create } = await setup();
    for (let i = 0; i < 3; i++) await create();
    expect(await code(create())).toBe("too_many_claims_today");

    // A day later the daily cap is free again; then five waiting is the most.
    await db.update(warrantyClaims).set({ createdAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(warrantyClaims.projectId, project.id));
    await create();
    await create();
    expect(await code(create())).toBe("too_many_open_claims");
  });

  it("is one claim when sent twice with the same key", async () => {
    const { create } = await setup();
    const key = "warranty-key-0001";

    const first = await create({ ...CLAIM, idempotencyKey: key });
    expect(await create({ ...CLAIM, idempotencyKey: key })).toEqual(first);
    expect(await code(create({ ...CLAIM, description: "Otra cosa", idempotencyKey: key }))).toBe("idempotency_key_reused");
    expect(await db.$count(warrantyClaims)).toBe(1);
  });

  it("adds up to four photos, each an image of at most 4 MB, with a thumbnail", async () => {
    const { tenant, client, create } = await setup();
    const { claimId } = await create();
    const add = (file: unknown, key?: string) =>
      svc.addClientClaimPhoto(tenant.id, client.id, claimId, { file, ...(key ? { idempotencyKey: key } : {}) });

    const { photoId } = await add(photo, "photo-key-000001");
    expect(await add(photo, "photo-key-000001")).toEqual({ photoId });
    expect(files.size).toBe(2); // the photo and its thumbnail
    const thumb = await svc.openClientClaimPhoto(tenant.id, client.id, claimId, photoId, "thumb");
    expect(thumb.contentType).toBe("image/webp");

    expect(await code(add(new File(["not an image"], "x.jpg", { type: "image/jpeg" })))).toBe("invalid_file_type");
    expect(await code(add(new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], "big.jpg")))).toBe("file_too_large");
    expect(await code(add(undefined))).toBe("missing_file");
    for (let i = 0; i < 3; i++) await add(photo);
    expect(await code(add(photo))).toBe("too_many_photos");

    const claim = await svc.getClientClaim(tenant.id, client.id, claimId);
    expect(claim.photoIds).toHaveLength(4);
    expect(claim.photoCount).toBe(4);
    expect(claim.events.map((e) => e.action)).toEqual(["created", "photo_added", "photo_added", "photo_added", "photo_added"]);
  });

  it("cancels a claim while nobody has started on it", async () => {
    const { tenant, client, project, ctx, create } = await setup();
    const { claimId } = await create();
    const cancel = (id = claimId) => svc.cancelClientClaim(tenant.id, client.id, id);

    expect(await cancel()).toEqual({ claimId });
    expect(await cancel()).toEqual({ claimId }); // a retry
    expect((await svc.getClientClaim(tenant.id, client.id, claimId)).status).toBe("cancelled");
    expect(await code(svc.updateClaim(ctx, project.id, claimId, { status: "in_review" }))).toBe("claim_cancelled");
    expect(await code(svc.addClientClaimPhoto(tenant.id, client.id, claimId, { file: photo }))).toBe("claim_closed");

    const started = await create();
    await svc.updateClaim(ctx, project.id, started.claimId, { status: "in_review" });
    expect(await code(cancel(started.claimId))).toBe("claim_closed");
    expect(await code(svc.addClientClaimPhoto(tenant.id, client.id, started.claimId, { file: photo }))).toBe("claim_closed");
  });

  it("refuses a photo for a closed or full claim before reading or storing the image", async () => {
    const { tenant, client, project, ctx, create } = await setup();
    const add = (claimId: string, file: unknown = photo) => svc.addClientClaimPhoto(tenant.id, client.id, claimId, { file });
    const full = await create();
    for (let i = 0; i < 4; i++) await add(full.claimId);
    const closed = await create();
    await svc.updateClaim(ctx, project.id, closed.claimId, { status: "in_review" });
    vi.mocked(putFile).mockClear();
    vi.mocked(readImage).mockClear();

    expect(await code(add(full.claimId))).toBe("too_many_photos");
    expect(await code(add(closed.claimId))).toBe("claim_closed");
    // The claim's state before the file's own faults.
    expect(await code(add(closed.claimId, new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], "big.jpg")))).toBe("claim_closed");
    expect(await code(add(full.claimId, new File(["not an image"], "x.jpg")))).toBe("too_many_photos");
    expect(readImage).not.toHaveBeenCalled();
    expect(putFile).not.toHaveBeenCalled();
  });

  it("keeps one client's key from answering another client's request", async () => {
    const { tenant, project, create } = await setup();
    const key = "shared-key-000001";
    await create({ ...CLAIM, idempotencyKey: key });
    // The home changes client; the new one happens to send the same key with the same claim.
    const other = await createTestUser(tenant.id, { role: "client" });
    await db.update(projects).set({ clientUserId: other.id }).where(eq(projects.id, project.id));

    expect(await code(svc.createClientClaim(tenant.id, other.id, project.id, { ...CLAIM, idempotencyKey: key }))).toBe(
      "idempotency_key_reused",
    );
    expect(await db.$count(warrantyClaims)).toBe(1);
  });

  it("never reaches another client's claim, nor one on a home no longer theirs", async () => {
    const { tenant, client, project, ctx, create } = await setup();
    const { claimId } = await create();
    const other = await createTestUser(tenant.id, { role: "client" });

    expect(await code(svc.getClientClaim(tenant.id, other.id, claimId))).toBe("not_found");
    expect(await code(svc.cancelClientClaim(tenant.id, other.id, claimId))).toBe("not_found");
    expect(await code(svc.addClientClaimPhoto(tenant.id, other.id, claimId, { file: photo }))).toBe("not_found");
    const elsewhere = await setup();
    expect(await code(svc.getClientClaim(elsewhere.tenant.id, elsewhere.client.id, claimId))).toBe("not_found");

    // The home given to someone else: their claims stay theirs, out of the new client's sight and the old one's.
    await db.update(projects).set({ clientUserId: other.id }).where(eq(projects.id, project.id));
    expect(await code(svc.getClientClaim(tenant.id, client.id, claimId))).toBe("not_found");
    expect((await svc.getClientWarranty(tenant.id, other.id, project.id))!.claims).toEqual([]);

    // A deleted home: nothing of it.
    await db.update(projects).set({ clientUserId: client.id }).where(eq(projects.id, project.id));
    await projectsService.deleteProject(ctx, project.id);
    expect(await code(svc.getClientClaim(tenant.id, client.id, claimId))).toBe("not_found");
    expect(await code(svc.listClaims(ctx, project.id))).toBe("project_not_found");
  });
});

describe("the guarantee's periods", () => {
  it("start at hand-over: none before it", async () => {
    const { tenant, client, project } = await setup({ stage: 6 });

    const warranty = await svc.getClientWarranty(tenant.id, client.id, project.id);
    expect(warranty).toMatchObject({ handedOver: false, handoverOn: null, handoverSource: null });
    expect(warranty!.coverage.map((c) => [c.scope, c.years, c.endsOn])).toEqual([
      ["finishes", 1, null],
      ["habitability", 3, null],
      ["structure", 10, null],
    ]);
  });

  it("run from H9's acta, else its payment, else the hand-over date the client was told", async () => {
    const { tenant, client, project } = await setup();
    const read = () => svc.getClientWarranty(tenant.id, client.id, project.id);

    expect(await read()).toMatchObject({ handedOver: true, handoverOn: "2026-03-31", handoverSource: "planned" });

    const [h9] = await db
      .insert(obraHitos)
      .values({ tenantId: tenant.id, projectId: project.id, code: "H9", name: "Entrega de llaves", pctBp: 300, scope: "s", billingMoment: "b", position: 9, paidOn: "2026-04-10", paidAmountCents: 100 })
      .returning();
    expect(await read()).toMatchObject({ handoverOn: "2026-04-10", handoverSource: "payment" });

    await db.update(obraHitos).set({ actaSignedOn: "2026-04-02" }).where(eq(obraHitos.id, h9!.id));
    const warranty = await read();
    expect(warranty).toMatchObject({ handoverOn: "2026-04-02", handoverSource: "acta" });
    expect(warranty!.coverage.map((c) => [c.endsOn, c.active])).toEqual([
      ["2027-04-02", "2027-04-02" >= todayInSpain()],
      ["2029-04-02", true],
      ["2036-04-02", true],
    ]);
  });

  it("adds whole years, 29 February becoming 28", () => {
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
    expect(addYears("2026-12-31", 10)).toBe("2036-12-31");
  });
});

describe("staff handling a claim", () => {
  it("move it on, answer it and schedule a visit, each step in its history", async () => {
    const { tenant, client, project, ctx, admin, create } = await setup();
    const { claimId } = await create();

    expect(await code(svc.updateClaim(ctx, project.id, claimId, { status: "scheduled" }))).toBe("visit_required");
    expect(await code(svc.updateClaim(ctx, project.id, claimId, { status: "rejected", answer: "  " }))).toBe("reason_required");
    expect(await code(svc.updateClaim(ctx, project.id, claimId, { status: "cancelled" }))).toBe("invalid_input");
    expect(await code(svc.updateClaim(ctx, project.id, claimId, { visitOn: "2026-02-30" }))).toBe("invalid_date");

    await svc.updateClaim(ctx, project.id, claimId, { status: "scheduled", visitOn: "2026-12-03", answer: "Pasaremos el jueves." });
    // Nothing new: nothing written.
    await svc.updateClaim(ctx, project.id, claimId, { status: "scheduled" });

    const claim = await svc.getClaim(ctx, project.id, claimId);
    expect(claim).toMatchObject({ status: "scheduled", visitOn: "2026-12-03", answer: "Pasaremos el jueves.", createdBy: client.name });
    expect(claim.answeredAt).not.toBeNull();
    expect(claim.events.map(({ action, byClient, by, detail }) => ({ action, byClient, by, detail }))).toEqual([
      { action: "created", byClient: true, by: client.name, detail: {} },
      {
        action: "updated",
        byClient: false,
        by: admin.name,
        detail: {
          status: { from: "received", to: "scheduled" },
          visitOn: { from: null, to: "2026-12-03" },
          answer: { from: null, to: "Pasaremos el jueves." },
        },
      },
    ]);
    // The client sees the step, not who did it.
    const seen = await svc.getClientClaim(tenant.id, client.id, claimId);
    expect(seen.events[1]).not.toHaveProperty("by");
    expect(seen.events[1]).toMatchObject({ byClient: false, action: "updated" });

    await svc.updateClaim(ctx, project.id, claimId, { status: "rejected", answer: "Es un uso indebido." });
    expect((await svc.listClaims(ctx, project.id)).claims[0]).toMatchObject({ status: "rejected", answer: "Es un uso indebido." });

    // Of the answers, the client gets the one standing on the claim, never the texts it replaced.
    const theirs = await svc.getClientClaim(tenant.id, client.id, claimId);
    expect(theirs.answer).toBe("Es un uso indebido.");
    expect(theirs.events.map((e) => e.detail)).toEqual([
      {},
      { status: { from: "received", to: "scheduled" }, visitOn: { from: null, to: "2026-12-03" }, answered: true },
      { status: { from: "scheduled", to: "rejected" }, answered: true },
    ]);
    expect(JSON.stringify(theirs.events)).not.toContain("Pasaremos el jueves");
    // Staff keep every text.
    expect((await svc.getClaim(ctx, project.id, claimId)).events[2]!.detail.answer).toEqual({
      from: "Pasaremos el jueves.",
      to: "Es un uso indebido.",
    });
  });

  it("is for admins and managers; viewers read", async () => {
    const { tenant, project, create } = await setup();
    const { claimId } = await create();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    const asViewer: Ctx = { tenantId: tenant.id, userId: viewer.id, role: "viewer" };

    expect(await code(svc.updateClaim(asViewer, project.id, claimId, { status: "in_review" }))).toBe("forbidden");
    expect((await svc.listClaims(asViewer, project.id)).claims).toHaveLength(1);
  });

  it("never reaches another tenant's or another project's claim", async () => {
    const { project, ctx, create } = await setup();
    const { claimId } = await create();
    const other = await setup();
    const sibling = await createTestProject(ctx.tenantId);

    expect(await code(svc.getClaim(other.ctx, project.id, claimId))).toBe("not_found");
    expect(await code(svc.updateClaim(other.ctx, project.id, claimId, { status: "in_review" }))).toBe("project_not_found");
    expect(await code(svc.updateClaim(ctx, sibling.id, claimId, { status: "in_review" }))).toBe("not_found");
    expect(await code(svc.listClaims(other.ctx, project.id))).toBe("project_not_found");
  });

  it("serves a claim's photo and its thumbnail to staff of the tenant only", async () => {
    const { tenant, client, project, ctx, create } = await setup();
    const { claimId } = await create();
    const { photoId } = await svc.addClientClaimPhoto(tenant.id, client.id, claimId, { file: photo });

    expect((await svc.openClaimPhoto(ctx, project.id, claimId, photoId)).contentType).toBe("image/jpeg");
    expect((await svc.openClaimPhoto(ctx, project.id, claimId, photoId, "thumb")).contentType).toBe("image/webp");
    const other = await setup();
    expect(await code(svc.openClaimPhoto(other.ctx, project.id, claimId, photoId))).toBe("not_found");
  });
});

describe("telling the client", () => {
  const TOKEN = "ExponentPushToken[phone-1]";

  it("pushes a new status, a visit day or an answer, under the messages toggle", async () => {
    const { tenant, client, project, ctx, create } = await setup();
    await clientAccountService.registerPushToken(tenant.id, client.id, { token: TOKEN });
    const { claimId } = await create();
    const pushed = () => vi.mocked(sendPush).mock.calls.map(([messages]) => messages.map((m) => m.body)).flat();

    await svc.updateClaim(ctx, project.id, claimId, { status: "in_review" });
    await svc.updateClaim(ctx, project.id, claimId, { status: "scheduled", visitOn: "2026-12-03" });
    await svc.updateClaim(ctx, project.id, claimId, { answer: "Llevaremos el repuesto." });
    await svc.updateClaim(ctx, project.id, claimId, { answer: null }); // cleared: nothing to tell
    expect(pushed()).toEqual([
      "GAR-001 está en revisión.",
      "GAR-001: te visitaremos el 3 de diciembre de 2026.",
      "Tu jefe de obra ha respondido a GAR-001.",
    ]);
    expect(vi.mocked(sendPush).mock.calls[0]![0][0]).toMatchObject({
      to: TOKEN,
      title: "Tu solicitud de garantía",
      data: { screen: "warranty", projectId: project.id, claimId },
    });

    vi.mocked(sendPush).mockClear();
    await clientAccountService.updateSettings(tenant.id, client.id, { notifications: { messages: false } });
    await svc.updateClaim(ctx, project.id, claimId, { status: "resolved" });
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("tells only the client who sent the claim, while the home is still theirs", async () => {
    const { tenant, project, ctx, create } = await setup();
    const { claimId } = await create();
    const other = await createTestUser(tenant.id, { role: "client" });
    await clientAccountService.registerPushToken(tenant.id, other.id, { token: TOKEN });
    await db.update(projects).set({ clientUserId: other.id }).where(eq(projects.id, project.id));

    await svc.updateClaim(ctx, project.id, claimId, { status: "in_review", answer: "Lo miramos." });

    expect(sendPush).not.toHaveBeenCalled();
  });

  it("writes each step once: the events of a claim are its own", async () => {
    const { ctx, project, create } = await setup();
    const { claimId } = await create();
    await svc.updateClaim(ctx, project.id, claimId, { status: "in_review" });

    const rows = await db.select().from(warrantyClaimEvents).where(eq(warrantyClaimEvents.claimId, claimId));
    expect(rows.map((r) => r.action).sort()).toEqual(["created", "updated"]);
  });
});
