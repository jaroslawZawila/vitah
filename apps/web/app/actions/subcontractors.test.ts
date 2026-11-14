import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { files } from "@repo/core/testing";
import { signInAs } from "../../test/session";
import { NOT_FOUND, TO_LOGIN } from "../../test/navigation";
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
  getWorkersPage,
  markNotApplicableAction,
  rejectSubcontractorDocumentAction,
  removeSubcontractorAssignmentAction,
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
  // Issued two days ago, so a monthly document is never near its expiry whatever day the tests run.
  data.set("issuedAt", new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10));
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
    // A page of them, with the filters of the list and the whole list's counts.
    await createWorkerAction({ subcontractorId: id, firstName: "Ana", surnames: "Abascal Ruiz", idDocument: "00000001R" });
    const page = (await getWorkersPage({ page: 2, limit: 1, projectId: project.id }))!;
    expect(page.workers.map((w) => w.surnames)).toEqual(["Llata Ceballos"]);
    expect(page.paging).toEqual({ page: 2, limit: 1, total: 2, pages: 2 });
    expect(page.summary).toMatchObject({ registered: 2, companies: 1, preventive: 1 });
    expect((await getWorkersPage({ page: 1, q: "abascal" }))!.workers.map((w) => w.surnames)).toEqual(["Abascal Ruiz"]);
    expect((await getWorkersPage({ page: 1, access: "ok" }))!).toMatchObject({ workers: [], counts: { all: 2 } });
    expect((await getWorkersPage())!.workers).toHaveLength(2);
    // A page that isn't one is the service's error: nothing is read.
    expect(await getWorkersPage({ page: "abc" })).toBeNull();
    expect(await checkWorkerAccessAction({ query: "72145836B" })).toEqual({
      result: expect.objectContaining({ worker: expect.objectContaining({ name: "Pedro Llata Ceballos" }) }),
    });
    expect(await checkWorkerAccessAction({ query: "" })).toEqual({ error: "missing_fields" });
  });

  it("removes a company from an obra once, and assigns it again", async () => {
    const { tenant } = await setup();
    const { id } = (await createSubcontractorAction(company))!;
    const project = await createTestProject(tenant.id);
    await assignSubcontractorAction(id!, project.id, { chapterCodes: ["05"], bookOrder: 3, bookDate: "2026-09-20" });
    vi.mocked(revalidatePath).mockClear();

    expect(await removeSubcontractorAssignmentAction(id!, project.id)).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");
    expect((await getSubcontractor(id!))!.assignments).toEqual([]);
    expect((await getSubcontractor(id!))!.history.map((h) => h.action)).toContain("unassigned");
    expect((await getWorkers(project.id))!).toEqual([]);

    // Already removed.
    vi.mocked(revalidatePath).mockClear();
    expect(await removeSubcontractorAssignmentAction(id!, project.id)).toEqual({ error: "not_found" });
    expect(revalidatePath).not.toHaveBeenCalled();

    expect(await assignSubcontractorAction(id!, project.id, { chapterCodes: ["13"] })).toEqual({ success: true });
    expect((await getSubcontractor(id!))!.assignments).toEqual([
      expect.objectContaining({ projectId: project.id, chapterCodes: ["13"], bookOrder: null, bookDate: null }),
    ]);
  });

  it("lets viewers read but not write", async () => {
    const { tenant } = await setup("manager");
    const { id } = (await createSubcontractorAction(company))!;
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    signInAs({ tenantId: tenant.id, userId: viewer.id, role: "viewer" });

    expect((await getSubcontractor(id!))!.canManage).toBe(false);
    expect(await updateSubcontractorAction(id!, { phone: "942 00 00 00" })).toEqual({ error: "forbidden" });
    expect(await removeSubcontractorAssignmentAction(id!, "any-obra")).toEqual({ error: "forbidden" });
  });

  it("is not found for another tenant's company", async () => {
    await setup();
    const { id } = (await createSubcontractorAction(company))!;
    await setup();

    await expect(getSubcontractor(id!)).rejects.toEqual(NOT_FOUND);
    await expect(getWorker("nobody")).rejects.toEqual(NOT_FOUND);
  });

  it("goes to the login page when signed out, reading or writing", async () => {
    signInAs(null);

    await expect(getSubcontractorsOverview()).rejects.toEqual(TO_LOGIN);
    await expect(getSubcontractorCounts()).rejects.toEqual(TO_LOGIN);
    await expect(createSubcontractorAction(company)).rejects.toEqual(TO_LOGIN);
  });
});
