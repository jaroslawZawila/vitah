import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { files } from "@repo/core/testing";
import { signInAs } from "../../test/session";
import {
  assignSubcontractorAction,
  checkWorkerAccessAction,
  createSubcontractorAction,
  createWorkerAction,
  getSubcontractor,
  getSubcontractorCounts,
  getSubcontractorsOverview,
  getWorker,
  getWorkers,
  markNotApplicableAction,
  rejectSubcontractorDocumentAction,
  requestSubcontractorDocumentsAction,
  updateSubcontractorAction,
  updateWorkerAction,
  uploadSubcontractorDocumentAction,
  validateSubcontractorDocumentAction,
} from "./subcontractors";

// The service is covered in packages/core; these tests cover the adapter:
// session → core → `{ error }` / revalidation.

vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

const company = {
  kind: "company",
  legalName: "Cubiertas Besaya S.L.",
  taxId: "B39123450",
  address: "Polígono La Vega 3",
  postalCode: "39300",
  city: "Torrelavega",
};

function upload(requirementId: string, extra: Record<string, string> = {}) {
  const data = new FormData();
  data.set("requirementId", requirementId);
  data.set("issuedAt", "2026-10-01");
  for (const [key, value] of Object.entries(extra)) data.set(key, value);
  data.set("file", new File(["%PDF-1.7 doc"], "doc.pdf", { type: "application/pdf" }));
  return data;
}

async function setup(role: "admin" | "manager" | "viewer" = "manager") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  signInAs({ tenantId: tenant.id, userId: user.id, role });
  return { tenant, user };
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.mocked(revalidatePath).mockClear();
});

describe("subcontractor actions", () => {
  it("creates a company and revalidates the dashboard (the rail counts it)", async () => {
    await setup();

    const created = await createSubcontractorAction(company);
    expect(created).toEqual({ success: true, id: expect.any(String) });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");
    expect((await getSubcontractorsOverview())!.companies.map((c) => c.legalName)).toEqual(["Cubiertas Besaya S.L."]);
    expect(await getSubcontractorCounts()).toEqual({ companies: 1, workers: 0, expiries: 0 });
  });

  it("returns core errors as state without revalidating", async () => {
    await setup();

    expect(await createSubcontractorAction({ ...company, taxId: "B39123451" })).toEqual({ error: "invalid_tax_id" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("uploads, validates, rejects, requests and marks documents", async () => {
    await setup();
    const { id } = (await createSubcontractorAction(company))!;

    expect(await uploadSubcontractorDocumentAction(id!, upload("cert_tgss"))).toEqual({ success: true });
    expect(await uploadSubcontractorDocumentAction(id!, upload("rea_subcontrata"))).toEqual({ success: true });
    const docs = (await getSubcontractor(id!))!.documents;
    const tgss = docs.find((d) => d.requirementId === "cert_tgss")!;
    const rea = docs.find((d) => d.requirementId === "rea_subcontrata")!;

    expect(await validateSubcontractorDocumentAction(id!, tgss.id!)).toEqual({ success: true });
    expect(await rejectSubcontractorDocumentAction(id!, rea.id!, "Ilegible")).toEqual({ success: true });
    expect(await rejectSubcontractorDocumentAction(id!, rea.id!, "Otra vez")).toEqual({ error: "nothing_to_review" });
    expect(await requestSubcontractorDocumentsAction(id!, { requirementIds: ["evaluacion_riesgos"] })).toEqual({
      success: true,
    });
    expect(await markNotApplicableAction(id!, "doc_maquinaria", "Sin maquinaria propia")).toEqual({ success: true });

    const states = Object.fromEntries((await getSubcontractor(id!))!.documents.map((d) => [d.requirementId, d.state]));
    expect(states).toMatchObject({
      cert_tgss: "validated",
      rea_subcontrata: "rejected",
      evaluacion_riesgos: "requested",
      doc_maquinaria: "not_applicable",
    });
  });

  it("updates a company, assigns it to an obra and manages its workers", async () => {
    const { tenant } = await setup();
    const { id } = (await createSubcontractorAction(company))!;
    const project = await createTestProject(tenant.id);

    expect(await updateSubcontractorAction(id!, { phone: "942 00 00 00" })).toEqual({ success: true, id });
    expect(await assignSubcontractorAction(id!, project.id, { chapterCodes: ["05"] })).toEqual({ success: true });
    const worker = await createWorkerAction({
      subcontractorId: id,
      firstName: "Pedro",
      surnames: "Llata Ceballos",
      idDocument: "72145836B",
    });
    expect(worker).toEqual({ success: true, id: expect.any(String) });
    expect(await updateWorkerAction(worker!.id!, { roles: ["preventive_resource"] })).toEqual({
      success: true,
      id: worker!.id,
    });

    expect((await getWorker(worker!.id!))!.roles).toEqual(["preventive_resource"]);
    expect((await getWorkers(project.id))!.map((w) => w.surnames)).toEqual(["Llata Ceballos"]);
    expect(await checkWorkerAccessAction({ query: "72145836B" })).toEqual({
      result: expect.objectContaining({ worker: expect.objectContaining({ name: "Pedro Llata Ceballos" }) }),
    });
    expect(await checkWorkerAccessAction({ query: "" })).toEqual({ error: "missing_fields" });
  });

  it("lets viewers read but not write", async () => {
    const { tenant } = await setup("manager");
    const { id } = (await createSubcontractorAction(company))!;
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    signInAs({ tenantId: tenant.id, userId: viewer.id, role: "viewer" });

    expect((await getSubcontractor(id!))!.canManage).toBe(false);
    expect(await updateSubcontractorAction(id!, { phone: "942 00 00 00" })).toEqual({ error: "forbidden" });
  });

  it("returns null for another tenant's company", async () => {
    await setup();
    const { id } = (await createSubcontractorAction(company))!;
    await setup();

    expect(await getSubcontractor(id!)).toBeNull();
    expect(await getWorker("nobody")).toBeNull();
  });

  it("reads nothing and refuses writes when signed out", async () => {
    signInAs(null);

    expect(await getSubcontractorsOverview()).toBeNull();
    expect(await getSubcontractorCounts()).toBeNull();
    await expect(createSubcontractorAction(company)).rejects.toThrow("Unauthorized");
  });
});
