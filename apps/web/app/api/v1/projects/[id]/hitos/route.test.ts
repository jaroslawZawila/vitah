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
  });

  it("keeps tenants apart", async () => {
    const { id, hitoId } = await setup();
    const other = await createTestTenant();
    const { token } = await staffToken(other.id);
    expect((await GET(apiRequest(token), routeParams({ id }))).status).toBe(404);
    expect((await getFile(apiRequest(token), routeParams({ id, hitoId, kind: "invoice" }))).status).toBe(404);
  });
});
