import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDocument,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { files } from "@repo/core/testing";
import { signInAs } from "../../test/session";
import {
  addProjectDocumentAction,
  deleteProjectDocumentAction,
  getProjectDocuments,
} from "./documents";

// The service itself is covered in packages/core; these tests cover the
// adapter: session → core → `{ error }` / revalidation.

vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

function form(fields: Record<string, string | File>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const pdf = () => new File(["%PDF-1.7\n"], "contrato.pdf", { type: "application/pdf" });

async function setup(role: "admin" | "manager" | "viewer" = "manager") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  const project = await createTestProject(tenant.id);
  signInAs({ tenantId: tenant.id, userId: user.id, role });
  return { tenant, project };
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.mocked(revalidatePath).mockClear();
});

describe("document actions", () => {
  it("uploads a document and revalidates the project page", async () => {
    const { project } = await setup();

    const state = await addProjectDocumentAction(
      project.id,
      null,
      form({ title: "Contrato", category: "contract", file: pdf() }),
    );

    expect(state).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`);
    expect(await getProjectDocuments(project.id)).toEqual({
      documents: [expect.objectContaining({ title: "Contrato", category: "contract" })],
      canManage: true,
    });
  });

  it("returns core errors as form state without revalidating", async () => {
    const { project } = await setup();

    const state = await addProjectDocumentAction(
      project.id,
      null,
      form({ title: "Contrato", category: "contract", file: new File(["hola"], "x.pdf") }),
    );

    expect(state).toEqual({ error: "invalid_file_type" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not let viewers delete", async () => {
    const { tenant, project } = await setup("viewer");
    const doc = await createTestDocument(tenant.id, project.id);

    expect(await deleteProjectDocumentAction(project.id, doc.id)).toEqual({ error: "forbidden" });
    expect(await getProjectDocuments(project.id)).toEqual({
      documents: [expect.objectContaining({ id: doc.id })],
      canManage: false,
    });
  });

  it("deletes a document", async () => {
    const { tenant, project } = await setup("admin");
    const doc = await createTestDocument(tenant.id, project.id);

    expect(await deleteProjectDocumentAction(project.id, doc.id)).toEqual({ success: true });
    expect((await getProjectDocuments(project.id)).documents).toEqual([]);
  });

  it("lists nothing for another tenant's project or when signed out", async () => {
    const { tenant, project } = await setup();
    await createTestDocument(tenant.id, project.id);

    await setup();
    expect((await getProjectDocuments(project.id)).documents).toEqual([]);

    signInAs(null);
    expect(await getProjectDocuments(project.id)).toEqual({ documents: [], canManage: false });
  });
});
