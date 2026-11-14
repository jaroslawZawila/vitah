import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPhoto, createTestTenant, resetDatabase } from "@repo/db/testing";
import { files } from "@repo/core/testing";
import { apiRequest, routeParams, seededObraProject, staffToken } from "../../../../../../test/api";
import { GET, PUT } from "./route";
import { GET as getOne, PATCH } from "./[hitoId]/route";
import { POST as addCheck } from "./[hitoId]/checks/route";
import { DELETE as deleteCheck, PATCH as patchCheck } from "./[hitoId]/checks/[checkId]/route";
import { PUT as setPhotos } from "./[hitoId]/photos/route";
import { DELETE as deleteFile, GET as getFile, PUT as putFile } from "./[hitoId]/files/[kind]/route";
import { DELETE as cancelPayment, PUT as pay } from "./[hitoId]/payment/route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

async function setup() {
  const { tenant, project } = await seededObraProject();
  const { token } = await staffToken(tenant.id);
  const id = project.id;
  const hitos = async () => (await (await GET(apiRequest(token), routeParams({ id }))).json()) as { id: string; code: string }[];
  const h4 = (await hitos()).find((h) => h.code === "H4")!;
  return { tenant, id, token, hitos, hitoId: h4.id };
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("/api/v1/projects/:id/hitos", () => {
  it("lists and edits hitos and their checks", async () => {
    const { id, token, hitos, hitoId } = await setup();
    expect(await hitos()).toHaveLength(10);

    expect((await PATCH(apiRequest(token, { method: "PATCH", body: { pctBp: 1400 } }), routeParams({ id, hitoId }))).status).toBe(200);
    const added = await addCheck(apiRequest(token, { method: "POST", body: { label: "Persianas" } }), routeParams({ id, hitoId }));
    expect(added.status).toBe(201);
    const { checkId } = await added.json();
    const other = (await hitos()).find((h) => h.code === "H5")!;
    const wrongHito = await patchCheck(apiRequest(token, { method: "PATCH", body: { done: true } }), routeParams({ id, hitoId: other.id, checkId }));
    expect(wrongHito.status).toBe(404);
    expect((await patchCheck(apiRequest(token, { method: "PATCH", body: { done: true } }), routeParams({ id, hitoId, checkId }))).status).toBe(200);
    expect((await deleteCheck(apiRequest(token, { method: "DELETE" }), routeParams({ id, hitoId, checkId }))).status).toBe(200);

    expect((await hitos()).find((h) => h.id === hitoId)).toMatchObject({ pctBp: 1400, checks: [{ label: "Prueba de estanqueidad provisional" }] });
  });

  it("reads one hito and saves the plan at once", async () => {
    const { id, token, hitos, hitoId } = await setup();
    expect(await (await getOne(apiRequest(token), routeParams({ id, hitoId }))).json()).toMatchObject({ code: "H4" });

    const h3 = (await hitos()).find((h) => h.code === "H3")!;
    const res = await PUT(
      apiRequest(token, { method: "PUT", body: { hitos: [{ id: h3.id, pctBp: 1400 }, { id: hitoId, pctBp: 1400 }] } }),
      routeParams({ id }),
    );
    expect(await res.json()).toEqual({ updated: 2 });
    const bad = await PUT(apiRequest(token, { method: "PUT", body: { hitos: [{ id: hitoId, pctBp: -5 }] } }), routeParams({ id }));
    expect(bad.status).toBe(400);
  });

  it("uploads, serves and removes the acta; records the payment", async () => {
    const { tenant, id, token, hitos, hitoId } = await setup();
    const photo = await createTestPhoto(tenant.id, id);
    const body = new FormData();
    body.set("file", new File(["%PDF-acta"], "acta.pdf"));
    body.set("date", "2026-10-20");
    const stored = files.size;

    expect((await putFile(apiRequest(token, { method: "PUT", body }), routeParams({ id, hitoId, kind: "acta" }))).status).toBe(200);
    const file = await getFile(apiRequest(token), routeParams({ id, hitoId, kind: "acta" }));
    expect(file.headers.get("Content-Type")).toBe("application/pdf");
    expect(await file.text()).toBe("%PDF-acta");
    expect((await getFile(apiRequest(token), routeParams({ id, hitoId, kind: "receipt" }))).status).toBe(404);

    expect((await setPhotos(apiRequest(token, { method: "PUT", body: { photoIds: [photo.id] } }), routeParams({ id, hitoId }))).status).toBe(200);
    expect((await pay(apiRequest(token, { method: "PUT", body: { paidOn: "2026-10-27" } }), routeParams({ id, hitoId }))).status).toBe(200);
    expect((await hitos()).find((h) => h.id === hitoId)).toMatchObject({ status: "paid", photoIds: [photo.id] });

    expect((await cancelPayment(apiRequest(token, { method: "DELETE" }), routeParams({ id, hitoId }))).status).toBe(200);
    expect((await deleteFile(apiRequest(token, { method: "DELETE" }), routeParams({ id, hitoId, kind: "acta" }))).status).toBe(200);
    expect((await getFile(apiRequest(token), routeParams({ id, hitoId, kind: "acta" }))).status).toBe(404);
    // Off the hito, still in storage.
    expect(files.size).toBe(stored + 1);
  });

  it("gives one hito's history, newest first, and only there", async () => {
    const { id, token, hitos, hitoId } = await setup();
    const body = new FormData();
    body.set("file", new File(["%PDF-acta"], "acta.pdf"));
    body.set("date", "2026-10-20");
    await putFile(apiRequest(token, { method: "PUT", body }), routeParams({ id, hitoId, kind: "acta" }));
    await pay(apiRequest(token, { method: "PUT", body: { paidOn: "2026-10-27", amountCents: 100_000 } }), routeParams({ id, hitoId }));
    await pay(apiRequest(token, { method: "PUT", body: { paidOn: "2026-10-28", amountCents: 120_000 } }), routeParams({ id, hitoId }));
    await cancelPayment(apiRequest(token, { method: "DELETE" }), routeParams({ id, hitoId }));

    const one = await (await getOne(apiRequest(token), routeParams({ id, hitoId }))).json();
    expect(one).toMatchObject({ code: "H4", paidOn: null, actaSignedOn: "2026-10-20" });
    expect(one.events).toEqual([
      { id: expect.any(String), at: expect.any(String), userName: expect.any(String), action: "payment_cancelled", detail: { paidOn: "2026-10-28", amountCents: 120_000 } },
      { id: expect.any(String), at: expect.any(String), userName: expect.any(String), action: "payment_registered", detail: { paidOn: "2026-10-28", amountCents: 120_000, previous: { paidOn: "2026-10-27", amountCents: 100_000 } } },
      { id: expect.any(String), at: expect.any(String), userName: expect.any(String), action: "payment_registered", detail: { paidOn: "2026-10-27", amountCents: 100_000, previous: null } },
      { id: expect.any(String), at: expect.any(String), userName: expect.any(String), action: "acta_uploaded", detail: { date: "2026-10-20", sizeBytes: 9, previous: null } },
    ]);
    // The list stays as installed clients know it.
    expect((await hitos()).find((h) => h.id === hitoId)).not.toHaveProperty("events");
  });

  it("refuses a payment dated after today or of nothing", async () => {
    const { id, token, hitoId } = await setup();
    const future = await pay(apiRequest(token, { method: "PUT", body: { paidOn: "2999-01-01" } }), routeParams({ id, hitoId }));
    expect(future.status).toBe(400);
    expect(await future.json()).toEqual({ error: "invalid_date" });
    const nothing = await pay(apiRequest(token, { method: "PUT", body: { paidOn: "2026-10-27", amountCents: 0 } }), routeParams({ id, hitoId }));
    expect(nothing.status).toBe(400);
    expect(await nothing.json()).toEqual({ error: "invalid_input" });
    expect((await (await getOne(apiRequest(token), routeParams({ id, hitoId }))).json()).events).toEqual([]);
  });

  it("keeps tenants apart", async () => {
    const { id, hitoId } = await setup();
    const other = await createTestTenant();
    const { token } = await staffToken(other.id);
    expect((await GET(apiRequest(token), routeParams({ id }))).status).toBe(404);
    expect((await getOne(apiRequest(token), routeParams({ id, hitoId }))).status).toBe(404);
    expect((await pay(apiRequest(token, { method: "PUT", body: { paidOn: "2026-10-27" } }), routeParams({ id, hitoId }))).status).toBe(404);
    expect((await getFile(apiRequest(token), routeParams({ id, hitoId, kind: "invoice" }))).status).toBe(404);
  });
});
